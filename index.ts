import { Config, getStack } from "@pulumi/pulumi";
import { Provider } from "@pulumi/kubernetes";
import { Namespace } from "@pulumi/kubernetes/core/v1";
import { Release } from "@pulumi/kubernetes/helm/v3";
import * as k8s from "@pulumi/kubernetes";

// ============================================================================
// CONFIGURATION - Easy to modify repositories
// ============================================================================

interface RunnerConfig {
    pulumiResourceName: string;  // Must match existing Pulumi resource names
    helmReleaseName: string;     // Must match existing Helm release names
    repository: string;          // GitHub repository (e.g., "RobbeVerhelst/DeBleserIT")
    minRunners?: number;         // Optional, defaults to 1
    maxRunners?: number;         // Optional, defaults to 3
}

// Add or modify repositories here
const repositories: RunnerConfig[] = [
    {
        pulumiResourceName: "arc-runner-set-debleserit",
        helmReleaseName: "arc-runner-set-debleserit",
        repository: "RobbeVerhelst/DeBleserIT",
        minRunners: 1,
        maxRunners: 3,
    },
    {
        pulumiResourceName: "arc-runner-set-maps",
        helmReleaseName: "arc-runner-set-maps",
        repository: "RobbeVerhelst/maps",
        minRunners: 1,
        maxRunners: 3,
    },
    {
        pulumiResourceName: "arc-runner-set-jurgenlis",
        helmReleaseName: "arc-runner-set-jurgenlis",
        repository: "RobbeVerhelst/jurgenlis",
        minRunners: 1,
        maxRunners: 3,
    },
    {
        pulumiResourceName: "arc-runner-set-psbeheer",
        helmReleaseName: "arc-runner-set-psbeheer",
        repository: "RobbeVerhelst/psbeheer",
        minRunners: 1,
        maxRunners: 3,
    },
    {
        pulumiResourceName: "arc-runner-set-website",
        helmReleaseName: "arc-runner-set-website",
        repository: "RobbeVerhelst/website",
        minRunners: 1,
        maxRunners: 3,
    },
    {
        pulumiResourceName: "arc-runner-set-observation-dashboard",
        helmReleaseName: "arc-runner-set-observation-dashboard",
        repository: "RobbeVerhelst/observation-dashboard",
        minRunners: 1,
        maxRunners: 3,
    }, 
];

// ============================================================================
// PULUMI CONFIGURATION
// ============================================================================

// Get stack name and configuration
const stack = getStack();
const config = new Config();
const githubConfig = new Config("github");

// Required configuration
const kubeconfig = config.require("kubeconfig");
const githubToken = githubConfig.requireSecret("token");

// Kubernetes provider
const k8sProvider = new Provider("k8s-provider", {
    kubeconfig: kubeconfig,
});

// ============================================================================
// INFRASTRUCTURE SETUP
// ============================================================================

// Step 1: Install cert-manager (exactly as in the quickstart guide)
// Create cert-manager namespace
const certManagerNs = new Namespace("cert-manager-ns", {
    metadata: { name: "cert-manager" },
}, { provider: k8sProvider });

// Install cert-manager using Helm
const certManagerChart = new Release("cert-manager", {
    name: "cert-manager",
    chart: "cert-manager",
    version: "v1.13.3",
    repositoryOpts: {
        repo: "https://charts.jetstack.io",
    },
    namespace: certManagerNs.metadata.name,
    values: {
        installCRDs: true,
    },
}, { provider: k8sProvider, dependsOn: [certManagerNs] });

// Step 2: Create the ARC system namespace
const arcSystemsNs = new Namespace("arc-systems-ns", {
    metadata: { name: "arc-systems" },
}, { provider: k8sProvider });

// Step 3: Install the ARC controller using Helm (exactly as in the quickstart guide)
const arcControllerChart = new Release("arc-controller", {
    name: "arc",
    chart: "actions-runner-controller",
    version: "0.23.7",
    repositoryOpts: {
        repo: "https://actions.github.io/actions-runner-controller",
    },
    namespace: arcSystemsNs.metadata.name,
    values: {
        authSecret: {
            create: true,
            github_token: githubToken,
        },
    },
}, { provider: k8sProvider, dependsOn: [arcSystemsNs, certManagerChart] });

// Step 4: Create the runners namespace
const arcRunnersNs = new Namespace("arc-runners-ns", {
    metadata: { name: "arc-runners" },
}, { provider: k8sProvider });

// Create a ClusterRoleBinding to give the controller admin permissions
const controllerClusterRoleBinding = new k8s.rbac.v1.ClusterRoleBinding("arc-controller-admin", {
    metadata: {
        name: "arc-controller-admin",
    },
    roleRef: {
        apiGroup: "rbac.authorization.k8s.io",
        kind: "ClusterRole",
        name: "cluster-admin",
    },
    subjects: [{
        kind: "ServiceAccount",
        name: "arc-actions-runner-controller",
        namespace: arcSystemsNs.metadata.name,
    }],
}, { provider: k8sProvider, dependsOn: [arcControllerChart] });

// Step 5: Install the gha-runner-scale-set-controller chart to get the CRDs
const runnerScaleSetControllerChart = new k8s.helm.v3.Release(
  "arc-runner-controller",
  {
    name: "arc-runner-controller",
    chart: "oci://ghcr.io/actions/actions-runner-controller-charts/gha-runner-scale-set-controller",
    version: "0.7.0",
    namespace: arcRunnersNs.metadata.name,
    values: {
        authSecret: {
            github_token: githubToken,
        },
        rbac: {
            create: true,
            useClusterRole: true,
        },
        serviceAccount: {
            annotations: {},
            create: true,
            name: "arc-runner-controller-gha-rs-controller",
        },
    },
  }, 
  { provider: k8sProvider, dependsOn: [arcRunnersNs, arcControllerChart, controllerClusterRoleBinding] }
);

// Create a Role for the runner controller service account to create roles and rolebindings
const runnerControllerRole = new k8s.rbac.v1.Role(
  "arc-runner-controller-role",
  {
    metadata: {
      name: "arc-runner-controller-role",
      namespace: arcRunnersNs.metadata.name,
    },
    rules: [
      {
        apiGroups: ["rbac.authorization.k8s.io"],
        resources: ["roles", "rolebindings"],
        verbs: ["create", "get", "list", "watch", "update", "patch", "delete"],
      },
      {
        apiGroups: ["actions.github.com"],
        resources: ["ephemeralrunnersets", "ephemeralrunners", "ephemeralrunners/status", "autoscalinglisteners"],
        verbs: ["create", "get", "list", "watch", "update", "patch", "delete"],
      },
    ],
  },
  { provider: k8sProvider, dependsOn: [arcRunnersNs, runnerScaleSetControllerChart] }
);

// Create a RoleBinding for the runner controller service account
const runnerControllerRoleBinding = new k8s.rbac.v1.RoleBinding(
  "arc-runner-controller-rolebinding",
  {
    metadata: {
      name: "arc-runner-controller-rolebinding",
      namespace: arcRunnersNs.metadata.name,
    },
    roleRef: {
      apiGroup: "rbac.authorization.k8s.io",
      kind: "Role",
      name: runnerControllerRole.metadata.name,
    },
    subjects: [
      {
        kind: "ServiceAccount",
        name: "arc-runner-controller-gha-rs-controller",
        namespace: arcRunnersNs.metadata.name,
      },
    ],
  },
  { provider: k8sProvider, dependsOn: [arcRunnersNs, runnerControllerRole] }
);

// ============================================================================
// RUNNER SCALE SETS - Generated from configuration array
// ============================================================================

// Helper function to create runner scale set values
function createRunnerScaleSetValues(repo: RunnerConfig) {
    return {
        githubConfigUrl: `https://github.com/${repo.repository}`,
        githubConfigSecret: {
            github_token: githubToken,
        },
        minRunners: repo.minRunners || 1,
        maxRunners: repo.maxRunners || 3,
        controllerServiceAccount: {
            name: "arc-actions-runner-controller",
            namespace: arcSystemsNs.metadata.name,
        },
        rbac: {
            create: true,
            rules: [
                {
                    apiGroups: ["rbac.authorization.k8s.io"],
                    resources: ["roles", "rolebindings"],
                    verbs: ["create", "get", "list", "watch", "update", "patch", "delete"],
                },
                {
                    apiGroups: ["actions.github.com"],
                    resources: ["ephemeralrunnersets", "ephemeralrunners", "ephemeralrunners/status"],
                    verbs: ["create", "get", "list", "watch", "update", "patch", "delete"],
                },
            ],
        },
    };
}

// Create runner scale sets for each repository
const runnerScaleSets: { [key: string]: k8s.helm.v3.Release } = {};

repositories.forEach((repo) => {
    runnerScaleSets[repo.pulumiResourceName] = new k8s.helm.v3.Release(
        repo.pulumiResourceName,  // Use exact existing Pulumi resource name
        {
            name: repo.helmReleaseName,  // Use exact existing Helm release name
            chart: "oci://ghcr.io/actions/actions-runner-controller-charts/gha-runner-scale-set",
            version: "0.7.0",
            namespace: arcRunnersNs.metadata.name,
            values: createRunnerScaleSetValues(repo),
        },
        { provider: k8sProvider, dependsOn: [arcRunnersNs, runnerScaleSetControllerChart, runnerControllerRoleBinding] }
    );
});

// ============================================================================
// EXPORTS
// ============================================================================

// Export useful values
export const certManagerNamespace = certManagerNs.metadata.name;
export const arcSystemsNamespace = arcSystemsNs.metadata.name;
export const arcRunnersNamespace = arcRunnersNs.metadata.name;
export const runnerSetName = "arc-runner-set"; // This is what you'll use in your GitHub Actions workflow's runs-on

// Export all runner set names for easy reference
export const runnerSetNames = repositories.map(repo => ({
    repository: repo.repository,
    runnerSetName: repo.helmReleaseName,
}));