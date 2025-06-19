import { Config } from "@pulumi/pulumi";
import { Provider } from "@pulumi/kubernetes";
import { Namespace } from "@pulumi/kubernetes/core/v1";
import { Release } from "@pulumi/kubernetes/helm/v3";
import { ClusterRoleBinding, Role, RoleBinding } from "@pulumi/kubernetes/rbac/v1";
import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

// ============================================================================
// CONSTANTS
// ============================================================================

const CHART_VERSIONS = {
    CERT_MANAGER: "v1.13.3",
    // TODO: Upgrade to consistent ARC v0.7.0 architecture in future release
    // Currently using mixed versions to maintain compatibility with existing infrastructure
    ARC_CONTROLLER_OLD: "0.23.7", // Legacy controller - to be replaced
    ARC_CONTROLLER_NEW: "0.7.0",  // New controller architecture
    ARC_RUNNER_SCALE_SET: "0.7.0",
} as const;

// TODO: Consolidate RBAC rules once we migrate to single ARC architecture
const RBAC_RULES = {
    RBAC_MANAGEMENT: {
        apiGroups: ["rbac.authorization.k8s.io"],
        resources: ["roles", "rolebindings"],
        verbs: ["create", "get", "list", "watch", "update", "patch", "delete"],
    },
    ARC_RESOURCES: {
        apiGroups: ["actions.github.com"],
        resources: [
            "ephemeralrunnersets",
            "ephemeralrunners",
            "ephemeralrunners/status",
            "autoscalinglisteners",
        ],
        verbs: ["create", "get", "list", "watch", "update", "patch", "delete"],
    },
};

// ============================================================================
// CONFIGURATION
// ============================================================================

interface RunnerConfig {
    helmReleaseName: string;
    repository: string;
    minRunners?: number;
    maxRunners?: number;
}

function generateResourceName(repository: string): string {
    return `arc-runner-set-${repository.split("/")[1].toLowerCase()}`;
}

function loadRunnerConfig(): RunnerConfig[] {
    const configPath = join(__dirname, "runners.config.json");

    if (!existsSync(configPath)) {
        throw new Error(
            `Configuration file not found: ${configPath}. Please copy runners.config.example.json to runners.config.json and customize it.`
        );
    }

    try {
        const configContent = readFileSync(configPath, "utf8");
        const config = JSON.parse(configContent) as RunnerConfig[];

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

// ============================================================================
// PULUMI SETUP
// ============================================================================

const config = new Config();
const githubConfig = new Config("github");
const repositories = loadRunnerConfig();

const kubeconfig = config.get("kubeconfig") || join(homedir(), ".kube", "config");
const githubToken = githubConfig.requireSecret("token");

const k8sProvider = new Provider("k8s-provider", {
    kubeconfig: kubeconfig,
});

// ============================================================================
// NAMESPACES
// ============================================================================

const certManagerNs = new Namespace(
    "cert-manager-ns",
    { metadata: { name: "cert-manager" } },
    { provider: k8sProvider }
);

const arcSystemsNs = new Namespace(
    "arc-systems-ns",
    { metadata: { name: "arc-systems" } },
    { provider: k8sProvider }
);

const arcRunnersNs = new Namespace(
    "arc-runners-ns",
    { metadata: { name: "arc-runners" } },
    { provider: k8sProvider }
);

// ============================================================================
// CERT-MANAGER
// ============================================================================

const certManagerChart = new Release(
    "cert-manager",
    {
        name: "cert-manager",
        chart: "cert-manager",
        version: CHART_VERSIONS.CERT_MANAGER,
        repositoryOpts: { repo: "https://charts.jetstack.io" },
        namespace: certManagerNs.metadata.name,
        values: { installCRDs: true },
    },
    { provider: k8sProvider, dependsOn: [certManagerNs] }
);

// ============================================================================
// ARC CONTROLLER (Legacy - TODO: Migrate to new architecture)
// ============================================================================

// TODO: Replace this with the new ARC controller architecture
// Currently keeping old controller to avoid breaking existing infrastructure
const arcControllerChart = new Release(
    "arc-controller",
    {
        name: "arc", // TODO: Change to "arc-controller" when migrating
        chart: "actions-runner-controller", // TODO: Change to new OCI chart
        version: CHART_VERSIONS.ARC_CONTROLLER_OLD, // TODO: Upgrade to v0.7.0
        repositoryOpts: {
            repo: "https://actions.github.io/actions-runner-controller", // TODO: Remove when using OCI
        },
        namespace: arcSystemsNs.metadata.name,
        values: {
            authSecret: {
                create: true, // TODO: Simplify when migrating
                github_token: githubToken,
            },
            // TODO: Add new RBAC and serviceAccount config when migrating
        },
    },
    { provider: k8sProvider, dependsOn: [arcSystemsNs, certManagerChart] }
);

// TODO: Update service account name to "arc-controller-gha-rs-controller" when migrating
const controllerClusterRoleBinding = new ClusterRoleBinding(
    "arc-controller-admin",
    {
        metadata: { name: "arc-controller-admin" },
        roleRef: {
            apiGroup: "rbac.authorization.k8s.io",
            kind: "ClusterRole",
            name: "cluster-admin",
        },
        subjects: [{
            kind: "ServiceAccount",
            name: "arc-actions-runner-controller", // TODO: Change to "arc-controller-gha-rs-controller"
            namespace: arcSystemsNs.metadata.name,
        }],
    },
    { provider: k8sProvider, dependsOn: [arcControllerChart] }
);

// ============================================================================
// NEW ARC CONTROLLER (Required for runner scale sets)
// ============================================================================

// This controller is needed for the new runner scale set architecture
const runnerScaleSetControllerChart = new Release(
    "arc-runner-controller",
    {
        name: "arc-runner-controller",
        chart: "oci://ghcr.io/actions/actions-runner-controller-charts/gha-runner-scale-set-controller",
        version: CHART_VERSIONS.ARC_CONTROLLER_NEW,
        namespace: arcRunnersNs.metadata.name,
        values: {
            authSecret: { github_token: githubToken },
            rbac: { create: true, useClusterRole: true },
            serviceAccount: {
                create: true,
                name: "arc-runner-controller-gha-rs-controller",
                annotations: {},
            },
        },
    },
    {
        provider: k8sProvider,
        dependsOn: [arcRunnersNs, arcControllerChart, controllerClusterRoleBinding],
    }
);

// ============================================================================
// RUNNER NAMESPACE RBAC
// ============================================================================

const runnerControllerRole = new Role(
    "arc-runner-controller-role",
    {
        metadata: {
            name: "arc-runner-controller-role",
            namespace: arcRunnersNs.metadata.name,
        },
        rules: [RBAC_RULES.RBAC_MANAGEMENT, RBAC_RULES.ARC_RESOURCES],
    },
    { provider: k8sProvider, dependsOn: [arcRunnersNs, runnerScaleSetControllerChart] }
);

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
        subjects: [{
            kind: "ServiceAccount",
            name: "arc-runner-controller-gha-rs-controller",
            namespace: arcRunnersNs.metadata.name, // Keep in runners namespace for now
        }],
    },
    { provider: k8sProvider, dependsOn: [runnerControllerRole] }
);

// ============================================================================
// RUNNER SCALE SETS
// ============================================================================

function createRunnerScaleSetValues(repo: RunnerConfig) {
    return {
        githubConfigUrl: `https://github.com/${repo.repository}`,
        githubConfigSecret: { github_token: githubToken },
        minRunners: repo.minRunners || 1,
        maxRunners: repo.maxRunners || 3,
        controllerServiceAccount: {
            // TODO: Change to "arc-controller-gha-rs-controller" when migrating to single controller
            name: "arc-actions-runner-controller", // Keep current name to avoid changes
            namespace: arcSystemsNs.metadata.name,
        },
        // TODO: Remove this RBAC config when we migrate to centralized RBAC
        rbac: {
            create: true,
            rules: [
                RBAC_RULES.RBAC_MANAGEMENT,
                {
                    apiGroups: ["actions.github.com"],
                    resources: [
                        "ephemeralrunnersets",
                        "ephemeralrunners",
                        "ephemeralrunners/status", // Note: missing "autoscalinglisteners" to match current config
                    ],
                    verbs: ["create", "get", "list", "watch", "update", "patch", "delete"],
                },
            ],
        },
    };
}

const runnerScaleSets: Record<string, Release> = {};

repositories.forEach((repo) => {
    const resourceName = generateResourceName(repo.repository);
    runnerScaleSets[resourceName] = new Release(
        resourceName,
        {
            name: repo.helmReleaseName,
            chart: "oci://ghcr.io/actions/actions-runner-controller-charts/gha-runner-scale-set",
            version: CHART_VERSIONS.ARC_RUNNER_SCALE_SET,
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

export const certManagerNamespace = certManagerNs.metadata.name;
export const arcSystemsNamespace = arcSystemsNs.metadata.name;
export const arcRunnersNamespace = arcRunnersNs.metadata.name;
// TODO: Remove this export when we migrate to single controller architecture
export const runnerSetName = "arc-runner-set";

export const runnerSetNames = repositories.map((repo) => ({
    repository: repo.repository,
    runnerSetName: repo.helmReleaseName,
}));
