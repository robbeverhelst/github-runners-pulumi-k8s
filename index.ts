import * as pulumi from "@pulumi/pulumi";
import { Config, getStack, Output } from "@pulumi/pulumi";
import { Provider } from "@pulumi/kubernetes";
import { Namespace, Secret } from "@pulumi/kubernetes/core/v1";
import { Release } from "@pulumi/kubernetes/helm/v3";
import { CustomResource } from "@pulumi/kubernetes/apiextensions";

// Configuration interface for GitHub Actions runners
export interface RunnerConfig {
    namespace: string;
    githubOrg: string;
    githubRepo?: string;
    runnerLabels: string[];
    minRunners: number;
    maxRunners: number;
    tokenSecretName: string;
}

// Actions Runner Controller class for deploying and managing runners
export class ActionRunnerController {
    private provider: Provider;
    private namespace: Namespace;
    private stackName: string;
    
    constructor(name: string, provider: Provider, stackName: string) {
        this.provider = provider;
        this.stackName = stackName;
        
        // Create a namespace for the Actions Runner Controller
        // Use stack name as prefix to ensure uniqueness
        this.namespace = new Namespace(`${stackName}-${name}`, {
            metadata: {
                name: `${stackName}-actions-runner-system`,
            },
        }, { provider });
    }
    
    // Install the Actions Runner Controller using Helm
    public installController(): void {
        // Use stack name as prefix for the release name
        const arcChart = new Release(`${this.stackName}-actions-runner-controller`, {
            chart: "actions-runner-controller",
            version: "0.23.5", // Use the latest stable version
            repositoryOpts: {
                repo: "https://actions-runner-controller.github.io/actions-runner-controller",
            },
            namespace: this.namespace.metadata.name,
            values: {
                authSecret: {
                    create: true,
                    name: `${this.stackName}-controller-manager`,
                },
            },
        }, { provider: this.provider, dependsOn: [this.namespace] });
    }
    
    // Deploy runners for a specific repository or organization
    public deployRunners(name: string, config: RunnerConfig): void {
        // Create namespace for runners if it doesn't exist
        const runnerNamespace = new Namespace(`${this.stackName}-${name}-namespace`, {
            metadata: {
                name: config.namespace,
            },
        }, { provider: this.provider });
        
        // Define the runner deployment
        const runnerDeployment = new CustomResource(`${this.stackName}-${name}-runner-deployment`, {
            apiVersion: "actions.summerwind.dev/v1alpha1",
            kind: "RunnerDeployment",
            metadata: {
                name: `${this.stackName}-${name}-runners`,
                namespace: config.namespace,
            },
            spec: {
                template: {
                    spec: {
                        organization: config.githubOrg,
                        repository: config.githubRepo,
                        labels: config.runnerLabels,
                        tokenGitHubSecret: config.tokenSecretName,
                    },
                },
                replicas: config.minRunners,
            },
        }, { provider: this.provider, dependsOn: [runnerNamespace] });
        
        // Create horizontal runner autoscaler if min and max runners are different
        if (config.minRunners !== config.maxRunners) {
            new CustomResource(`${this.stackName}-${name}-runner-autoscaler`, {
                apiVersion: "actions.summerwind.dev/v1alpha1",
                kind: "HorizontalRunnerAutoscaler",
                metadata: {
                    name: `${this.stackName}-${name}-runner-autoscaler`,
                    namespace: config.namespace,
                },
                spec: {
                    scaleTargetRef: {
                        name: runnerDeployment.metadata.name,
                    },
                    minReplicas: config.minRunners,
                    maxReplicas: config.maxRunners,
                    metrics: [
                        {
                            type: "TotalNumberOfQueuedAndInProgressWorkflowRuns",
                            scaleUpThreshold: "1",
                            scaleDownThreshold: "0",
                            scaleUpFactor: "2",
                            scaleDownFactor: "0.5",
                        },
                    ],
                },
            }, { provider: this.provider, dependsOn: [runnerDeployment] });
        }
    }
}

// Get the current stack name to determine which configuration to use
const stack = getStack();

// Get configuration from Pulumi config
const config = new Config();
const kubeconfig = config.requireSecret("kubeconfig");
const githubToken = config.requireSecret("githubToken");

// Read runner configuration from stack config
const namespace = config.require("namespace");
const githubOrg = config.require("githubOrg");
const githubRepo = config.get("githubRepo") || undefined;
const runnerLabels = config.getObject<string[]>("runnerLabels") || ["self-hosted", "kubernetes"];
const minRunners = config.getNumber("minRunners") || 1;
const maxRunners = config.getNumber("maxRunners") || 3;
const tokenSecretName = config.get("tokenSecretName") || `${stack}-github-token`;

// Create a Kubernetes provider
const k8sProvider = new Provider(`${stack}-k8s-provider`, {
    kubeconfig: kubeconfig.toString(),
});

// Initialize the Actions Runner Controller
const arc = new ActionRunnerController("arc", k8sProvider, stack);
arc.installController();

// Create the namespace for the runners
const runnerNamespace = new Namespace(`${stack}-runner-namespace`, {
    metadata: {
        name: namespace,
    },
}, { provider: k8sProvider });

// Create the GitHub token secret in the runner namespace
const githubTokenSecret = new Secret(`${stack}-github-token-secret`, {
    metadata: {
        name: tokenSecretName,
        namespace: namespace,
    },
    stringData: {
        "github_token": githubToken,
    },
}, { provider: k8sProvider, dependsOn: [runnerNamespace] });

// Configure runners for the current stack
const runnerConfig: RunnerConfig = {
    namespace,
    githubOrg,
    githubRepo,
    runnerLabels,
    minRunners,
    maxRunners,
    tokenSecretName,
};

// Deploy runners for the current stack
arc.deployRunners(stack, runnerConfig);

// Export relevant information
export const runnerNamespaceName = namespace;
export const runnerLabelsExport = runnerLabels;
export const organizationName = githubOrg;
export const repositoryName = githubRepo;
