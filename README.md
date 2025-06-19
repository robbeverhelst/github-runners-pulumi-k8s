# GitHub Actions Self-Hosted Runners

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Pulumi](https://img.shields.io/badge/Pulumi-8A3391?logo=pulumi&logoColor=white)](https://www.pulumi.com/)
[![Kubernetes](https://img.shields.io/badge/Kubernetes-326CE5?logo=kubernetes&logoColor=white)](https://kubernetes.io/)
[![GitHub Actions](https://img.shields.io/badge/GitHub%20Actions-2088FF?logo=github-actions&logoColor=white)](https://github.com/features/actions)
[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-FFDD00?logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/robbeverhec)

Deploy self-hosted GitHub Actions runners on Kubernetes using [Pulumi](https://www.pulumi.com/) and [Actions Runner Controller (ARC)](https://github.com/actions/actions-runner-controller).

## Benefits

- Custom hardware configurations and longer running workflows
- Access to internal resources and dependency reuse
- Cost optimization for high-volume CI/CD
- Multi-repository support from single configuration

## Prerequisites

- Kubernetes cluster with `kubectl` access
- Pulumi CLI and Node.js with pnpm
- GitHub Personal Access Token

## Quick Start

1. **Clone and install dependencies:**
   ```bash
   git clone https://github.com/RobbeVerhelst/github-runners-pulumi-k8s.git
   cd github-runners-pulumi-k8s
   pnpm install
   ```

2. **Configure runners:**
   ```bash
   cp runners.config.example.json runners.config.json
   # Edit runners.config.json with your repositories
   ```

3. **Setup Pulumi stack:**
   ```bash
   pulumi stack select production  # or create new stack
   pulumi config set --secret github:token "your-github-token"
   # Optional: pulumi config set kubeconfig "path/to/kubeconfig"
   ```

4. **Deploy:**
   ```bash
   pulumi up
   ```

## Configuration

Edit `runners.config.json` to define your runners:

```json
[
    {
        "helmReleaseName": "arc-runner-set-my-repo",
        "repository": "username/my-repository",
        "minRunners": 1,
        "maxRunners": 3
    }
]
```

**Fields:**
- `helmReleaseName`: Unique name for the Helm release
- `repository`: GitHub repository in `owner/repo` format
- `minRunners`: Minimum runners to keep running (default: 1)
- `maxRunners`: Maximum runners to scale to (default: 3)

## Usage in GitHub Actions

```yaml
jobs:
  build:
    runs-on: arc-runner-set-my-repo  # Use your helmReleaseName
    steps:
      # Your workflow steps
```

## GitHub Token Permissions

Your token needs:
- `repo` scope for private repositories
- `public_repo` scope for public repositories  
- `admin:org` scope for organization-level runners

## File Structure

```
├── index.ts                    # Main Pulumi program
├── runners.config.json         # Your runner configuration (not in git)
├── runners.config.example.json # Example configuration
├── Pulumi.yaml                 # Project configuration
├── Pulumi.production.yaml      # Stack configuration
└── setup-stack-config.sh      # Helper script
```

## Management Commands

```bash
# Stack management
pulumi stack ls
pulumi stack select <stack-name>
pulumi stack output

# Adding repositories: Edit runners.config.json, then:
pulumi up

# Test cluster connectivity
kubectl get nodes
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Configuration file not found | Create `runners.config.json` from example |
| Runners not registering | Check pod logs for auth issues |
| Workflows not using runners | Verify correct `runs-on` name in workflow |
| Runner pods crashing | Check resource limits and node capacity |
| Kubernetes auth issues | Verify kubeconfig path and test with `kubectl get nodes` |

## Maintenance

- **Update ARC**: Change chart version in `index.ts`
- **Scale runners**: Modify `minRunners`/`maxRunners` in config
- **Monitor**: Use Kubernetes dashboard or monitoring tools

## License

MIT License - see LICENSE file for details.
