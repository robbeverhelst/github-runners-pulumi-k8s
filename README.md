# GitHub Actions Self-Hosted Runners

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Pulumi](https://img.shields.io/badge/Pulumi-8A3391?logo=pulumi&logoColor=white)](https://www.pulumi.com/)
[![Kubernetes](https://img.shields.io/badge/Kubernetes-326CE5?logo=kubernetes&logoColor=white)](https://kubernetes.io/)
[![GitHub Actions](https://img.shields.io/badge/GitHub%20Actions-2088FF?logo=github-actions&logoColor=white)](https://github.com/features/actions)
[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-FFDD00?logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/robbeverhec)

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

The repository is structured to deploy multiple runner scale sets for different repositories from a single configuration:

```
.
├── index.ts                    # Main program file with runner deployment logic
├── runners.config.json         # Runner configuration (not in git - contains private repo info)
├── runners.config.example.json # Example configuration file
├── Pulumi.yaml                 # Pulumi project configuration
├── Pulumi.production.yaml      # Stack configuration for production
└── setup-stack-config.sh      # Helper script for stack configuration
```

The runner configuration is kept in a separate `runners.config.json` file that is not tracked in git, allowing the repository to be made public without exposing private repository information.

## Prerequisites

- Kubernetes cluster
- `kubectl` configured to access your cluster
- Pulumi CLI installed
- GitHub Personal Access Token with appropriate permissions
- Node.js and pnpm

## Setup

1. Clone this repository:

    ```bash
    git clone https://github.com/RobbeVerhelst/github-runners-pulumi-k8s.git
    cd github-runners-pulumi-k8s
    ```

2. Install dependencies:

    ```bash
    pnpm install
    ```

3. Create your runner configuration:

    ```bash
    # Copy the example configuration
    cp runners.config.example.json runners.config.json

    # Edit the configuration with your repositories
    # The file should contain an array of runner configurations
    ```

4. Configure the Pulumi stack:

    ```bash
    # Select the production stack (or create a new one)
    pulumi stack select production

    # Configure required settings
    pulumi config set --secret github:token "your-github-token"

    # Optional: Set custom kubeconfig path (defaults to ~/.kube/config)
    # pulumi config set kubeconfig "path/to/your/kubeconfig"
    ```

5. Deploy the infrastructure:
    ```bash
    pulumi up
    ```

## Adding a New Repository

To add runners for a new repository:

1. Edit your `runners.config.json` file:

    ```json
    [
        {
            "helmReleaseName": "arc-runner-set-my-new-repo",
            "repository": "username/my-new-repository",
            "minRunners": 1,
            "maxRunners": 3
        }
    ]
    ```

2. Deploy the updated configuration:
    ```bash
    pulumi up
    ```

## Configuration File Structure

The `runners.config.json` file should contain an array of runner configurations:

```json
[
    {
        "helmReleaseName": "arc-runner-set-example-repo",
        "repository": "username/repository-name",
        "minRunners": 1,
        "maxRunners": 3
    }
]
```

**Configuration Fields:**

- `helmReleaseName`: Name of the Helm release (must be unique across all runners)
- `repository`: GitHub repository in the format `owner/repo`
- `minRunners`: Minimum number of runners to keep running (optional, defaults to 1)
- `maxRunners`: Maximum number of runners to scale up to (optional, defaults to 3)

> **Note**: Pulumi resource names are automatically generated from the repository name (e.g., `username/my-repo` → `arc-runner-set-my-repo`)

## GitHub Actions Configuration

To use self-hosted runners in your GitHub Actions workflows, specify the runner set name:

```yaml
jobs:
    build:
        runs-on: arc-runner-set-example-repo # Use the helmReleaseName from your config
        steps:
            # Your workflow steps
```

## Managing the Deployment

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

## Stack Configuration

The Pulumi stack requires the following configuration:

```bash
# GitHub token (stored as secret) - REQUIRED
pulumi config set --secret github:token "your-github-token"

# Kubernetes configuration file path - OPTIONAL (defaults to ~/.kube/config)
pulumi config set kubeconfig "path/to/your/kubeconfig"
```

> Note: The GitHub token needs the following permissions:
>
> - `repo` scope for private repositories
> - `public_repo` scope for public repositories
> - `admin:org` scope if configuring organization-level runners

## Important Files

- `runners.config.json` - Contains your private repository configuration (not tracked in git)
- `runners.config.example.json` - Example configuration file (tracked in git)
- `index.ts` - Main Pulumi program that deploys the infrastructure
- `.gitignore` - Ensures `runners.config.json` is not committed to git

## Troubleshooting

Common issues and solutions:

- **Configuration file not found**: Make sure you've created `runners.config.json` from the example file
- **Runners not registering**: Check the runner pod logs for authentication issues
- **Workflows not using self-hosted runners**: Ensure the correct runner set name is specified in your workflow
- **Runner pods crashing**: Check resource limits and node capacity
- **Kubernetes authentication issues**:
    - Verify your kubeconfig path is correct in the Pulumi configuration
    - Test connectivity to your cluster:
        ```bash
        kubectl get nodes
        ```

## Maintenance

- **Updating ARC**: Update the chart version in `index.ts`
- **Adding/removing repositories**: Edit `runners.config.json` and run `pulumi up`
- **Scaling runners**: Adjust `minRunners` and `maxRunners` in your configuration file
- **Monitoring**: Use Kubernetes dashboard or tools to monitor runner pods

## License

This project is licensed under the MIT License - see the LICENSE file for details.
