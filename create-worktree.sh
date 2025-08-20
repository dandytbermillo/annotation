#!/bin/bash

# Git Worktree Creation Script
# Usage: ./create-worktree.sh [feature-name] [base-branch]
# Example: ./create-worktree.sh migrate-to-postgres main

set -e  # Exit on any error

# Default values
DEFAULT_FEATURE="new-feature"
DEFAULT_BASE="main"
WORKTREE_BASE_DIR="../../"

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to display usage
show_usage() {
    echo "Usage: $0 [feature-name] [base-branch]"
    echo ""
    echo "Arguments:"
    echo "  feature-name    Name of the feature branch (default: $DEFAULT_FEATURE)"
    echo "  base-branch     Base branch to branch from (default: $DEFAULT_BASE)"
    echo ""
    echo "Examples:"
    echo "  $0 migrate-to-postgres"
    echo "  $0 user-auth main"
    echo "  $0 bug-fix development"
    echo ""
    echo "The worktree will be created at: $WORKTREE_BASE_DIR[feature-name]"
}

# Parse arguments
FEATURE_NAME="${1:-$DEFAULT_FEATURE}"
BASE_BRANCH="${2:-$DEFAULT_BASE}"

# Show help if requested
if [[ "$1" == "-h" || "$1" == "--help" ]]; then
    show_usage
    exit 0
fi

# Validate we're in a Git repository
if ! git rev-parse --git-dir > /dev/null 2>&1; then
    print_error "Not in a Git repository!"
    exit 1
fi

# Display configuration
print_status "Creating worktree with the following configuration:"
echo "  Feature branch: $FEATURE_NAME"
echo "  Base branch: $BASE_BRANCH"
echo "  Worktree path: $WORKTREE_BASE_DIR/$FEATURE_NAME"
echo ""

# Check if base branch exists
if ! git show-ref --verify --quiet refs/heads/$BASE_BRANCH; then
    if ! git show-ref --verify --quiet refs/remotes/origin/$BASE_BRANCH; then
        print_error "Base branch '$BASE_BRANCH' does not exist locally or remotely!"
        exit 1
    fi
fi

# Create worktree base directory if it doesn't exist
FULL_WORKTREE_PATH="$WORKTREE_BASE_DIR/$FEATURE_NAME"
print_status "Creating worktree base directory..."
mkdir -p "$WORKTREE_BASE_DIR"

# Check if branch already exists and handle it
if git show-ref --verify --quiet refs/heads/$FEATURE_NAME; then
    print_warning "Branch '$FEATURE_NAME' already exists!"
    
    # Check if it's checked out in a worktree
    if git worktree list | grep -q "\[$FEATURE_NAME\]"; then
        EXISTING_WORKTREE=$(git worktree list | grep "\[$FEATURE_NAME\]" | awk '{print $1}')
        print_error "Branch '$FEATURE_NAME' is already checked out at: $EXISTING_WORKTREE"
        echo ""
        echo "Options:"
        echo "1. Remove existing worktree: git worktree remove '$EXISTING_WORKTREE'"
        echo "2. Use a different feature name"
        exit 1
    fi
    
    # Ask user what to do
    echo "What would you like to do?"
    echo "1. Delete existing branch and create new worktree"
    echo "2. Create worktree from existing branch"
    echo "3. Cancel"
    read -p "Choose option (1-3): " choice
    
    case $choice in
        1)
            print_status "Deleting existing branch '$FEATURE_NAME'..."
            git branch -D "$FEATURE_NAME"
            ;;
        2)
            print_status "Using existing branch '$FEATURE_NAME'..."
            git worktree add "$FULL_WORKTREE_PATH" "$FEATURE_NAME"
            print_success "Worktree created successfully!"
            print_status "Navigate to worktree: cd $FULL_WORKTREE_PATH"
            exit 0
            ;;
        3)
            print_status "Operation cancelled."
            exit 0
            ;;
        *)
            print_error "Invalid choice. Exiting."
            exit 1
            ;;
    esac
fi

# Check if worktree directory already exists
if [[ -d "$FULL_WORKTREE_PATH" ]]; then
    print_warning "Directory '$FULL_WORKTREE_PATH' already exists!"
    print_status "Cleaning up existing directory..."
    rm -rf "$FULL_WORKTREE_PATH"
fi

# Clean up any prunable worktrees
print_status "Cleaning up any orphaned worktrees..."
git worktree prune

# Create the worktree
print_status "Creating worktree '$FEATURE_NAME' from '$BASE_BRANCH'..."
if git worktree add -b "$FEATURE_NAME" "$FULL_WORKTREE_PATH" "$BASE_BRANCH"; then
    print_success "Worktree created successfully!"
    
    # Handle dependencies with pnpm
    if [[ -f "package.json" ]]; then
        print_status "Node.js project detected. Setting up dependencies..."
        
    # Handle dependencies for Node.js projects
    if [[ -f "package.json" ]]; then
        print_status "Node.js project detected. Setting up dependencies..."
        
        # Check if main project has node_modules
        if [[ -d "node_modules" ]]; then
            print_status "Main project has dependencies installed."
            
            # Copy package-lock.json for faster, consistent installs
            if [[ -f "package-lock.json" ]]; then
                cp package-lock.json "$FULL_WORKTREE_PATH/"
                print_status "Copied package-lock.json for consistent dependency versions"
            fi
            
            # Install fresh to avoid binary/symlink issues
            print_status "Installing dependencies (using existing lock file for speed)..."
            (cd "$FULL_WORKTREE_PATH" && npm ci --legacy-peer-deps 2>/dev/null || npm install --legacy-peer-deps)
            
            if [[ $? -eq 0 ]]; then
                print_success "Dependencies installed successfully!"
            else
                print_error "Failed to install dependencies!"
            fi
        else
            print_warning "No node_modules found in main project. Installing fresh..."
            (cd "$FULL_WORKTREE_PATH" && npm install --legacy-peer-deps)
        fi
    fi
    fi
    
    # Display information
    echo ""
    print_status "Worktree Information:"
    git worktree list
    
    echo ""
    print_success "Next steps:"
    echo "  1. Navigate to worktree: cd $FULL_WORKTREE_PATH"
    echo "  2. Run 'npm run dev' or 'pnpm dev' to start development"
    echo "  3. When done, remove worktree: git worktree remove $FULL_WORKTREE_PATH"
    
    # Offer to navigate to the worktree
    echo ""
    read -p "Would you like to navigate to the worktree now? (y/N): " navigate
    if [[ "$navigate" =~ ^[Yy]$ ]]; then
        cd "$FULL_WORKTREE_PATH"
        print_success "You are now in the worktree directory:"
        pwd
        echo ""
        print_status "Current branch:"
        git branch --show-current
        echo ""
        print_status "Available files:"
        ls -la
    fi
else
    print_error "Failed to create worktree!"
    exit 1
fi