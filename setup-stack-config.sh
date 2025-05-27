#!/bin/bash

# Colors for better readability
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}GitHub Actions Runner Stack Configuration Setup${NC}"
echo "This script will help you set up the necessary configuration for your Pulumi stack."
echo ""

# Stack selection or creation
echo -e "${BLUE}Available stacks:${NC}"
pulumi stack ls

echo ""
echo -e "${YELLOW}Stack options:${NC}"
echo "1. Select an existing stack"
echo "2. Create a new stack"
read -p "Choose an option (1/2): " STACK_OPTION

if [ "$STACK_OPTION" = "1" ]; then
    # Select existing stack
    read -p "Enter the name of the stack to select: " STACK_NAME
    pulumi stack select "$STACK_NAME"
    if [ $? -ne 0 ]; then
        echo -e "${RED}Failed to select stack. Exiting.${NC}"
        exit 1
    fi
elif [ "$STACK_OPTION" = "2" ]; then
    # Create new stack
    read -p "Enter a name for the new stack: " STACK_NAME
    pulumi stack init "$STACK_NAME"
    if [ $? -ne 0 ]; then
        echo -e "${RED}Failed to create stack. Exiting.${NC}"
        exit 1
    fi
else
    echo -e "${RED}Invalid option. Exiting.${NC}"
    exit 1
fi

# Get the current stack
CURRENT_STACK=$(pulumi stack)
echo -e "${BLUE}Current stack: $CURRENT_STACK${NC}"
echo ""

# Ask for GitHub organization
read -p "GitHub organization name: " GITHUB_ORG
pulumi config set github:organization "$GITHUB_ORG"
echo -e "${GREEN}✓ GitHub organization set to: $GITHUB_ORG${NC}"

# Ask for GitHub token
read -p "GitHub token (for runner authentication): " GITHUB_TOKEN
pulumi config set --secret github:token "$GITHUB_TOKEN"
echo -e "${GREEN}✓ GitHub token set (stored securely)${NC}"

# Ask for autoscaler configuration
echo ""
echo "Autoscaler configuration:"
read -p "Minimum replicas [1]: " MIN_REPLICAS
MIN_REPLICAS=${MIN_REPLICAS:-1}
pulumi config set autoscaler:minReplicas "$MIN_REPLICAS"

read -p "Maximum replicas [3]: " MAX_REPLICAS
MAX_REPLICAS=${MAX_REPLICAS:-3}
pulumi config set autoscaler:maxReplicas "$MAX_REPLICAS"

read -p "Scale up threshold [1]: " SCALE_UP_THRESHOLD
SCALE_UP_THRESHOLD=${SCALE_UP_THRESHOLD:-1}
pulumi config set autoscaler:scaleUpThreshold "$SCALE_UP_THRESHOLD"

read -p "Scale down threshold [0]: " SCALE_DOWN_THRESHOLD
SCALE_DOWN_THRESHOLD=${SCALE_DOWN_THRESHOLD:-0}
pulumi config set autoscaler:scaleDownThreshold "$SCALE_DOWN_THRESHOLD"

read -p "Scale up factor [2]: " SCALE_UP_FACTOR
SCALE_UP_FACTOR=${SCALE_UP_FACTOR:-2}
pulumi config set autoscaler:scaleUpFactor "$SCALE_UP_FACTOR"

read -p "Scale down factor [0.5]: " SCALE_DOWN_FACTOR
SCALE_DOWN_FACTOR=${SCALE_DOWN_FACTOR:-0.5}
pulumi config set autoscaler:scaleDownFactor "$SCALE_DOWN_FACTOR"

echo -e "${GREEN}✓ Autoscaler configuration set${NC}"

# Ask for kubeconfig
echo ""
echo "Kubernetes configuration:"
read -p "Path to kubeconfig file: " KUBECONFIG_PATH

# Expand tilde to home directory if present
if [[ "$KUBECONFIG_PATH" == "~"* ]]; then
    KUBECONFIG_PATH="${KUBECONFIG_PATH/#\~/$HOME}"
fi

if [ -f "$KUBECONFIG_PATH" ]; then
    KUBECONFIG_CONTENT=$(cat "$KUBECONFIG_PATH")
    pulumi config set --secret kubeconfig "$KUBECONFIG_CONTENT"
    echo -e "${GREEN}✓ Kubeconfig set from: $KUBECONFIG_PATH${NC}"
else
    echo -e "${RED}File not found: $KUBECONFIG_PATH${NC}"
    echo "Please enter the kubeconfig content manually."
    read -p "Kubeconfig content: " KUBECONFIG_CONTENT
    pulumi config set --secret kubeconfig "$KUBECONFIG_CONTENT"
    echo -e "${GREEN}✓ Kubeconfig set manually${NC}"
fi

echo ""
echo -e "${GREEN}Configuration complete!${NC}"
echo "You can now run 'pulumi up' to deploy your GitHub Actions runners." 