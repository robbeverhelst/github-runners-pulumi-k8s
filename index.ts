import { Config, getStack } from "@pulumi/pulumi";
import { Provider } from "@pulumi/kubernetes";
import { Namespace } from "@pulumi/kubernetes/core/v1";
import { Release } from "@pulumi/kubernetes/helm/v3";
import { ClusterRoleBinding, Role, RoleBinding } from "@pulumi/kubernetes/rbac/v1";
import { Release as HelmRelease } from "@pulumi/kubernetes/helm/v3";
import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

// ============================================================================
// CONFIGURATION - Easy to modify repositories
// ============================================================================

interface RunnerConfig {
    helmReleaseName: string; // Must match existing Helm release names
    repository: string; // GitHub repository (e.g., "RobbeVerhelst/DeBleserIT")
    minRunners?: number; // Optional, defaults to 1
    maxRunners?: number; // Optional, defaults to 3
}

// Generate Pulumi resource name from repository
function generateResourceName(repository: string): string {
    return `arc-runner-set-${repository.split("/")[1].toLowerCase()}`;
}

// Load repositories from external configuration file
function loadRunnerConfig(): RunnerConfig[] {
    const configPath = join(__dirname, "runners.config.json");

    if (!existsSync(configPath)) {
        throw new Error(
            `Configuration file not found: ${configPath}. Please copy runners.config.example.json to runners.config.json and customize it with your repositories.`
        );
    }

    try {
        const configContent = readFileSync(configPath, "utf8");
        const config = JSON.parse(configContent) as RunnerConfig[];

        // Validate the configuration
        if (!Array.isArray(config)) {
            throw new Error("Configuration must be an array of RunnerConfig objects");
        }

        config.forEach((repo, index) => {
            if (!repo.helmReleaseName || !repo.repository) {
                throw new Error(
                    `Invalid configuration at index ${index}: helmReleaseName and repository are required`
                );
            }
        });

        return config;
    } catch (error) {
        if (error instanceof SyntaxError) {
            throw new Error(`Invalid JSON in configuration file: ${error.message}`);
        }
        throw error;
    }
}

const repositories: RunnerConfig[] = loadRunnerConfig();

// ============================================================================
// PULUMI CONFIGURATION
// ============================================================================

// Get stack name and configuration
const stack = getStack();
const config = new Config();
const githubConfig = new Config("github");

// Configuration
const kubeconfig = config.get("kubeconfig") || join(homedir(), ".kube", "config");
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
const certManagerNs = new Namespace(
    "cert-manager-ns",
    {
        metadata: { name: "cert-manager" },
    },
    { provider: k8sProvider }
);

// Install cert-manager using Helm
const certManagerChart = new Release(
    "cert-manager",
    {
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
    },
    { provider: k8sProvider, dependsOn: [certManagerNs] }
);

// Step 2: Create the ARC system namespace
const arcSystemsNs = new Namespace(
    "arc-systems-ns",
    {
        metadata: { name: "arc-systems" },
    },
    { provider: k8sProvider }
);

// Step 3: Install the ARC controller using Helm (exactly as in the quickstart guide)
const arcControllerChart = new Release(
    "arc-controller",
    {
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
    },
    { provider: k8sProvider, dependsOn: [arcSystemsNs, certManagerChart] }
);

// Step 4: Create the runners namespace
const arcRunnersNs = new Namespace(
    "arc-runners-ns",
    {
        metadata: { name: "arc-runners" },
    },
    { provider: k8sProvider }
);

// Create a ClusterRoleBinding to give the controller admin permissions
const controllerClusterRoleBinding = new ClusterRoleBinding(
    "arc-controller-admin",
    {
        metadata: {
            name: "arc-controller-admin",
        },
        roleRef: {
            apiGroup: "rbac.authorization.k8s.io",
            kind: "ClusterRole",
            name: "cluster-admin",
        },
        subjects: [
            {
                kind: "ServiceAccount",
                name: "arc-actions-runner-controller",
                namespace: arcSystemsNs.metadata.name,
            },
        ],
    },
    { provider: k8sProvider, dependsOn: [arcControllerChart] }
);

// Step 5: Install the gha-runner-scale-set-controller chart to get the CRDs
const runnerScaleSetControllerChart = new HelmRelease(
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
    {
        provider: k8sProvider,
        dependsOn: [arcRunnersNs, arcControllerChart, controllerClusterRoleBinding],
    }
);

// Create a Role for the runner controller service account to create roles and rolebindings
const runnerControllerRole = new Role(
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
                resources: [
                    "ephemeralrunnersets",
                    "ephemeralrunners",
                    "ephemeralrunners/status",
                    "autoscalinglisteners",
                ],
                verbs: ["create", "get", "list", "watch", "update", "patch", "delete"],
            },
        ],
    },
    { provider: k8sProvider, dependsOn: [arcRunnersNs, runnerScaleSetControllerChart] }
);

// Create a RoleBinding for the runner controller service account
const runnerControllerRoleBinding = new RoleBinding(
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
                    resources: [
                        "ephemeralrunnersets",
                        "ephemeralrunners",
                        "ephemeralrunners/status",
                    ],
                    verbs: ["create", "get", "list", "watch", "update", "patch", "delete"],
                },
            ],
        },
    };
}

// Create runner scale sets for each repository
const runnerScaleSets: { [key: string]: HelmRelease } = {};

repositories.forEach((repo) => {
    const resourceName = generateResourceName(repo.repository);
    runnerScaleSets[resourceName] = new HelmRelease(
        resourceName, // Auto-generated Pulumi resource name
        {
            name: repo.helmReleaseName, // Use exact existing Helm release name
            chart: "oci://ghcr.io/actions/actions-runner-controller-charts/gha-runner-scale-set",
            version: "0.7.0",
            namespace: arcRunnersNs.metadata.name,
            values: createRunnerScaleSetValues(repo),
        },
        {
            provider: k8sProvider,
            dependsOn: [arcRunnersNs, runnerScaleSetControllerChart, runnerControllerRoleBinding],
        }
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
export const runnerSetNames = repositories.map((repo) => ({
    repository: repo.repository,
    runnerSetName: repo.helmReleaseName,
}));
