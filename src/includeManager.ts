import * as fs from 'fs/promises';
import * as path from 'path';
import picomatch from 'picomatch';
import { DEFAULT_INCLUDE_CONTENT } from './defaultInclude';
import * as vscode from 'vscode';

export class IncludeManager {
    private includePatterns: string[] = [];
    private excludePatterns: string[] = [];
    private includeFilePath: string;
    private fileWatcher?: vscode.FileSystemWatcher;
    private _onPatternsChanged = new vscode.EventEmitter<void>();
    readonly onPatternsChanged = this._onPatternsChanged.event;

    // Compiled matchers for better performance
    private includeMatcher: picomatch.Matcher | null = null;
    private excludeMatcher: picomatch.Matcher | null = null;

    constructor(workspaceRoot: string) {
        this.includeFilePath = path.join(workspaceRoot, '.groupedtimelineinclude');

        this.writeIncludeFileIfDoesNotExist();
    }

    async writeIncludeFileIfDoesNotExist(): Promise<void> {
        try {
            await fs.access(this.includeFilePath);
        } catch {
            // Create default include file if it doesn't exist
            await fs.writeFile(this.includeFilePath, DEFAULT_INCLUDE_CONTENT);
        }
    }

    async loadPatterns(): Promise<void> {
        await this.writeIncludeFileIfDoesNotExist();

        const content = await fs.readFile(this.includeFilePath, 'utf-8');
        const patterns = content
            .split('\n')
            .map(line => line.trim())
            .filter(line => line && !line.startsWith('#'));

        // Separate include and exclude patterns
        this.includePatterns = patterns.filter(p => !p.startsWith('!'));
        this.excludePatterns = patterns
            .filter(p => p.startsWith('!'))
            .map(p => p.slice(1)); // Remove the ! prefix

        // Compile matchers
        const picoOptions = {
            dot: true,
            matchBase: true,
            ignore: this.excludePatterns
        };

        this.includeMatcher = this.includePatterns.length > 0 
            ? picomatch(this.includePatterns, picoOptions)
            : null;
        this.excludeMatcher = this.excludePatterns.length > 0
            ? picomatch(this.excludePatterns, picoOptions)
            : null;
    }

    shouldInclude(filePath: string, workspaceRoot: string): boolean {
        // Get path relative to workspace root
        const relativePath = path.relative(workspaceRoot, filePath);
        
        // Don't include the .groupedtimelineinclude file
        if (path.basename(relativePath) === '.groupedtimelineinclude') {
            return false;
        }

        // Check exclusions first
        if (this.excludeMatcher && this.excludeMatcher(relativePath)) {
            return false;
        }

        // Then check inclusions
        return this.includeMatcher ? this.includeMatcher(relativePath) : false;
    }

    dispose(): void {
        this.fileWatcher?.dispose();
        this._onPatternsChanged.dispose();
    }

    getPatterns(): { includes: string[], excludes: string[] } {
        return {
            includes: [...this.includePatterns],
            excludes: [...this.excludePatterns]
        };
    }
} 