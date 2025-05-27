# GitHub Actions Self-Hosted Runners

This repository manages self-hosted GitHub Actions runners for various projects using [Pulumi](https://www.pulumi.com/) to deploy [Actions Runner Controller (ARC)](https://github.com/actions/actions-runner-controller) on a Kubernetes cluster.

## Overview

Self-hosted runners provide several advantages over GitHub-hosted runners:
- Custom hardware configurations
- Longer running workflows
- Access to internal resources
- Reuse of dependencies between runs
- Cost optimization for high-volume CI/CD

This repository uses:
- **Pulumi**: Infrastructure as Code tool to manage deployments
- **Kubernetes**: Container orchestration platform
- **Helm**: Package manager for Kubernetes
- **Actions Runner Controller**: Kubernetes controller for GitHub Actions self-hosted runners

## Architecture

The repository is structured to use Pulumi's native stack system for managing different configurations:

```
.
├── index.ts                # Main program file with runner deployment logic
├── Pulumi.yaml             # Pulumi project configuration
├── Pulumi.debleserit.yaml  # Stack configuration for DeBleserIT
├── Pulumi.do.yaml          # Stack configuration for DigitalOcean
└── Pulumi.biosgarden.yaml  # Stack configuration for BiosGarden
```

Each stack configuration file contains all the settings needed for that specific project, including:
- Runner namespace
- GitHub organization or repository
- Runner labels
- Autoscaling configuration

All resources are prefixed with the stack name to ensure uniqueness when deploying multiple stacks to the same Kubernetes cluster.

## Prerequisites

- Kubernetes cluster
- `kubectl` configured to access your cluster
- Pulumi CLI installed
- GitHub Personal Access Token with appropriate permissions
- Node.js and pnpm

## Setup

1. Clone this repository:
   ```bash
   git clone https://github.com/RobbeVerhelst/github-actions-runners.git
   cd github-actions-runners
   ```

2. Install dependencies:
   ```bash
   pnpm install
   ```

3. Select a stack to work with:
   ```bash
   pulumi stack select debleserit
   ```

4. Configure the required secrets for the selected stack:
   ```bash
   # Configure GitHub token
   pulumi config set --secret githubToken "your-github-token"
   ```

5. Ensure your Kubernetes configuration is set up:
   ```bash
   # Make sure your KUBECONFIG environment variable is set correctly
   export KUBECONFIG=~/path/to/your/kubeconfig
   
   # Verify connectivity to your cluster
   kubectl get nodes
   ```

6. Deploy the stack:
   ```bash
   pulumi up
   ```

## Adding a New Project

To add runners for a new project:

1. Create a new stack:
   ```bash
   pulumi stack init newproject
   ```

2. Configure the new stack with all required settings:
   ```bash
   pulumi stack select newproject
   
   pulumi config set --secret githubToken "your-github-token"
   pulumi config set namespace "newproject-runners"
   pulumi config set githubOrg "NewProjectOrg"
   pulumi config set runnerLabels '["self-hosted", "kubernetes", "newproject"]'
   pulumi config set minRunners 1
   pulumi config set maxRunners 3
   pulumi config set tokenSecretName "newproject-github-token"
   ```

3. Deploy the new stack:
   ```bash
   pulumi up
   ```

## GitHub Actions Configuration

To use self-hosted runners in your GitHub Actions workflows, specify the appropriate labels:

```yaml
jobs:
  build:
    runs-on: self-hosted # or specific labels like [self-hosted, kubernetes, debleserit]
    steps:
      # Your workflow steps
```

## Managing Stacks

List all stacks:
```bash
pulumi stack ls
```

Switch between stacks:
```bash
pulumi stack select <stack-name>
```

View stack outputs:
```bash
pulumi stack output
```

## Stack Configuration Reference

Each stack configuration file (`Pulumi.<stack-name>.yaml`) contains the following settings:

```yaml
config:
  # Secrets (set these using pulumi config set --secret)
  github-actions-runners:githubToken:
    secure: ""
  
  # Runner configuration
  github-actions-runners:namespace: "project-runners"
  github-actions-runners:githubOrg: "OrganizationName"
  github-actions-runners:githubRepo: "optional-specific-repo"  # Optional
  github-actions-runners:runnerLabels:
    - "self-hosted"
    - "kubernetes"
    - "project-specific-label"
  github-actions-runners:minRunners: 1
  github-actions-runners:maxRunners: 3
  github-actions-runners:tokenSecretName: "project-github-token"  # Should be unique per stack
```

> Note: Kubernetes authentication is handled using your local kubeconfig file. 
> Make sure your KUBECONFIG environment variable is properly set to point to your kubeconfig file
> before running Pulumi commands.

## Resource Naming

All resources created by this project are prefixed with the stack name to ensure uniqueness when deploying multiple stacks to the same Kubernetes cluster. For example:

- Namespaces: `<stack>-actions-runner-system`, `<stack>-runners`
- Helm releases: `<stack>-actions-runner-controller`
- Secrets: `<stack>-github-token-secret`
- Runner deployments: `<stack>-<n>-runners`

This ensures that multiple stacks can coexist in the same Kubernetes cluster without conflicts.

## Troubleshooting

Common issues and solutions:

- **Runners not registering**: Check the runner pod logs for authentication issues
- **Workflows not using self-hosted runners**: Ensure the correct labels are specified in your workflow
- **Runner pods crashing**: Check resource limits and node capacity
- **Kubernetes authentication issues**: 
  - The deployment uses your default Kubernetes configuration
  - Ensure your KUBECONFIG environment variable is set correctly:
    ```bash
    export KUBECONFIG=~/path/to/your/kubeconfig
    ```
  - Verify connectivity to your cluster with:
    ```bash
    kubectl get nodes
    ```

## Maintenance

- **Updating ARC**: Update the chart version in `index.ts`
- **Scaling runners**: Adjust `minRunners` and `maxRunners` in the stack configuration
- **Monitoring**: Use Kubernetes dashboard or tools to monitor runner pods

## License

This project is licensed under the MIT License - see the LICENSE file for details.