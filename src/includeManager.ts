import * as fs from 'fs/promises';
import * as path from 'path';
import { minimatch } from 'minimatch';
import { DEFAULT_INCLUDE_CONTENT } from './defaultInclude';
import * as vscode from 'vscode';

export class IncludeManager {
    private patterns: string[] = [];
    private includeFilePath: string;
    private fileWatcher?: vscode.FileSystemWatcher;
    private _onPatternsChanged = new vscode.EventEmitter<void>();
    readonly onPatternsChanged = this._onPatternsChanged.event;

    constructor(workspaceRoot: string) {
        this.includeFilePath = path.join(workspaceRoot, '.groupedhistoryinclude');
    }

    async loadPatterns(): Promise<void> {
        const content = await fs.readFile(this.includeFilePath, 'utf-8');
        this.patterns = content
            .split('\n')
            .map(line => line.trim())
            .filter(line => line && !line.startsWith('#'));
    }

    async initialize(): Promise<void> {
        try {
            await fs.access(this.includeFilePath);
        } catch {
            // Create default include file if it doesn't exist
            await fs.writeFile(this.includeFilePath, DEFAULT_INCLUDE_CONTENT);
        }

        await this.loadPatterns();
    }

    shouldInclude(filePath: string, workspaceRoot: string): boolean {
        // Get path relative to workspace root
        const relativePath = path.relative(workspaceRoot, filePath);
        // Don't include the .groupedhistoryinclude file
        if (path.basename(relativePath) === '.groupedhistoryinclude') {
            return false;
        }
        return this.patterns.some(pattern => minimatch(relativePath, pattern, { 
            dot: true,  // Include dotfiles
            matchBase: true  // Match basename of path
        }));
    }

    dispose(): void {
        this.fileWatcher?.dispose();
        this._onPatternsChanged.dispose();
    }

    getPatterns(): string[] {
        return [...this.patterns];
    }
} 