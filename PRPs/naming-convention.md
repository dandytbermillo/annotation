# PRP Naming Convention Guide

## Purpose
Ensure consistent PRP file naming to avoid duplicates when re-running `/generate-prp`

## Naming Rules

### 1. Feature-based naming
- Use the main feature name from INITIAL.md
- Keep it consistent across iterations

### 2. Standard mappings
| Initial File | PRP Name |
|-------------|----------|
| initial.md (postgres) | PRPs/postgres-persistence.md |
| initial.md (auth) | PRPs/authentication.md |
| initial.md (search) | PRPs/search-feature.md |
| feature-xyz.md | PRPs/xyz.md |

### 3. Update existing PRPs
When running `/generate-prp` again:
1. Check if PRP exists with grep/find
2. UPDATE the existing file
3. Add version header:
   ```yaml
   version: 2
   last_updated: 2024-01-15
   reason: Fixed browser context issue
   ```

### 4. Avoid these patterns
- ❌ postgres-persistence-fix.md
- ❌ postgres-persistence-enhanced.md  
- ❌ postgres-persistence-v2.md
- ✅ postgres-persistence.md (with version: 2 inside)

## Example workflow
```bash
# First run
/generate-prp initial.md
# Creates: PRPs/postgres-persistence.md

# Error occurs, need to update
/generate-prp initial.md
# Updates: PRPs/postgres-persistence.md (version: 2)
# NOT: PRPs/postgres-persistence-fix.md
```