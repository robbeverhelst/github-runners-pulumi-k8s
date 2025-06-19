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

# Check if runners.config.json exists
if [ ! -f "runners.config.json" ]; then
    echo -e "${YELLOW}Creating runner configuration file...${NC}"
    if [ -f "runners.config.example.json" ]; then
        cp runners.config.example.json runners.config.json
        echo -e "${GREEN}✓ Created runners.config.json from example${NC}"
        echo -e "${YELLOW}Please edit runners.config.json with your repository information before continuing.${NC}"
        read -p "Press Enter after you've edited the configuration file..."
    else
        echo -e "${RED}runners.config.example.json not found. Please create runners.config.json manually.${NC}"
        exit 1
    fi
else
    echo -e "${GREEN}✓ runners.config.json already exists${NC}"
fi

# Stack selection or creation
echo ""
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

# Ask for GitHub token (required)
read -p "GitHub token (required for runner authentication): " GITHUB_TOKEN
if [ -z "$GITHUB_TOKEN" ]; then
    echo -e "${RED}GitHub token is required. Exiting.${NC}"
    exit 1
fi
pulumi config set --secret github:token "$GITHUB_TOKEN"
echo -e "${GREEN}✓ GitHub token set (stored securely)${NC}"

# Ask for kubeconfig (optional)
echo ""
echo -e "${YELLOW}Kubernetes configuration (optional - defaults to ~/.kube/config):${NC}"
read -p "Path to kubeconfig file [~/.kube/config]: " KUBECONFIG_PATH

if [ -n "$KUBECONFIG_PATH" ]; then
    # Expand tilde to home directory if present
    if [[ "$KUBECONFIG_PATH" == "~"* ]]; then
        KUBECONFIG_PATH="${KUBECONFIG_PATH/#\~/$HOME}"
    fi
    
    if [ -f "$KUBECONFIG_PATH" ]; then
        pulumi config set kubeconfig "$KUBECONFIG_PATH"
        echo -e "${GREEN}✓ Kubeconfig path set to: $KUBECONFIG_PATH${NC}"
    else
        echo -e "${RED}File not found: $KUBECONFIG_PATH${NC}"
        echo "Will use default ~/.kube/config"
    fi
else
    echo -e "${GREEN}✓ Will use default kubeconfig location (~/.kube/config)${NC}"
fi

echo ""
echo -e "${GREEN}Configuration complete!${NC}"
echo ""
echo -e "${BLUE}Next steps:${NC}"
echo "1. Make sure your runners.config.json contains your repository information"
echo "2. Ensure your kubeconfig has access to your Kubernetes cluster"
echo "3. Run 'pulumi up' to deploy your GitHub Actions runners"
echo ""
echo -e "${YELLOW}Tip: You can test your configuration with 'pulumi preview' first${NC}" 