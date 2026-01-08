# DocWatch Agent Guidelines

This file contains build commands, code style guidelines, and development conventions for agentic coding agents working in the DocWatch repository.

## Build/Test Commands

### Development
- `npm run start` - Start application (macOS)
- `npm run start:win` - Start application (Windows with UTF-8)
- `npm run start:alt` - Alternative start command
- `npm run start:mac` - Start application (macOS alternative)

### Building
- `npm run build` - Build for current platform
- `npm run build:win` - Build Windows installer
- `npm run build:mac` - Build macOS DMG/ZIP
- `npm run build:all` - Build for all platforms
- `npm run build:portable` - Build Windows portable version

### Testing
- `node test-simple.js` - Basic Electron runtime test
- `node test-electron.js` - Electron module loading test
- `node test-electron-check.js` - Electron environment validation

## Project Architecture

DocWatch is an Electron-based desktop application for local business automation, featuring:
- File watching and document processing
- Meeting transcription and summarization
- Extension system (VSCode-like)
- P2P messaging
- Local AI integration (Whisper + Ollama)

### Key Directories
- `main.js` - Electron main process
- `server.js` - Local HTTP server
- `extensions/` - Extension system implementation
- `bundled-extensions/` - Built-in extensions
- `public/` - Frontend HTML/CSS/JS
- `docs/` - Documentation and guides
- `bin/` - Whisper CLI binaries
- `models/` - AI model files

## Code Style Guidelines

### JavaScript/Node.js Conventions
- Use ES6+ features (async/await, destructuring, arrow functions)
- Prefer `const` over `let`, avoid `var`
- Use semicolons consistently
- Indentation: 2 spaces (no tabs)
- Maximum line length: 120 characters

### Import Organization
```javascript
// Node.js core modules
const fs = require('fs');
const path = require('path');

// Electron modules
const { app, BrowserWindow } = require('electron');

// Third-party dependencies
const express = require('express');

// Local modules
const ExtensionManager = require('./extensions/ExtensionManager');
```

### Error Handling
- Use try-catch blocks for synchronous operations
- Use .catch() for promises or async/await with try-catch
- Log errors with context information
- Provide meaningful error messages in Korean (primary language) or English

### Naming Conventions
- **Files**: kebab-case (e.g., `extension-manager.js`)
- **Variables**: camelCase (e.g., `extensionManager`)
- **Classes**: PascalCase (e.g., `ExtensionManager`)
- **Constants**: UPPER_SNAKE_CASE (e.g., `DEFAULT_PORT`)
- **Functions**: camelCase, descriptive verbs (e.g., `loadExtension`)

### Comment Style
- Use JSDoc-style comments for functions and classes
- Comments in Korean when possible, English as fallback
- Include parameter types and return values
- Add usage examples for complex functions

```javascript
/**
 * 확장을 로드하고 활성화합니다
 * @param {string} extensionPath - 확장 경로
 * @param {Object} options - 로드 옵션
 * @returns {Promise<Extension>} 로드된 확장 인스턴스
 */
async function loadExtension(extensionPath, options = {}) {
    // Implementation
}
```

## Extension Development

### Extension Structure
Extensions follow VSCode-like patterns:
- `package.json` - Extension manifest
- `src/extension.js` - Main entry point
- Activation events in manifest
- Contribution points for commands, UI elements

### Extension API
- Use `ExtensionAPI` class for safe operations
- Emit events for extension communication
- Handle lifecycle properly (activate/deactivate)
- Access controlled through permission system

## Platform-Specific Considerations

### Windows
- Set UTF-8 encoding: `chcp 65001`
- Handle path separators correctly
- Use `process.env.LOCALAPPDATA` for user data

### macOS
- Use code signing for distribution
- Handle sandbox permissions
- Use `process.env.HOME` for user data

### Cross-Platform
- Use `path.join()` for file paths
- Check `process.platform` for platform-specific code
- Test on all target platforms

## Security Best Practices

- Never commit secrets or API keys
- Use environment variables for configuration
- Validate all user inputs
- Sanitize file paths to prevent directory traversal
- Use secure IPC communication between processes

## Performance Guidelines

- Lazy load modules when possible
- Use streaming for large file operations
- Implement proper cleanup in event handlers
- Monitor memory usage in long-running processes
- Optimize AI model loading and inference

## Testing Strategy

- Test Electron runtime environment before main app logic
- Validate extension loading/unloading
- Test file watching functionality
- Verify cross-platform compatibility
- Test AI model integration separately

## Common Patterns

### Event Emission
```javascript
class MyClass extends EventEmitter {
    doSomething() {
        // Emit events for state changes
        this.emit('statusChanged', { status: 'processing' });
    }
}
```

### Async Operations
```javascript
async function processFile(filePath) {
    try {
        const content = await fs.promises.readFile(filePath, 'utf8');
        return await processContent(content);
    } catch (error) {
        console.error(`Failed to process ${filePath}:`, error);
        throw error;
    }
}
```

### IPC Communication
```javascript
// Main process
ipcMain.handle('get-data', async (event, arg) => {
    return await fetchData(arg);
});

// Renderer process
const data = await ipcRenderer.invoke('get-data', param);
```

## Linting and Formatting

This project does not currently have formal linting configured. When adding linting:
- Consider ESLint with Electron preset
- Use Prettier for consistent formatting
- Add pre-commit hooks for code quality

## Dependencies Management

- Use `npm` for package management
- Keep dependencies minimal for performance
- Prefer Electron-specific packages when available
- Update dependencies regularly for security

## Documentation

- Maintain Korean documentation as primary
- Provide English translations for broader adoption
- Update README.md for user-facing changes
- Document extension API changes thoroughly