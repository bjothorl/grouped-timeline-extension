import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { HistoryEntry } from './types';
import { IncludeManager } from './includeManager';

interface EntriesJson {
    version: number;
    resource: string;
    entries: {
        id: string;
        timestamp: number;
    }[];
}

export class HistoryReader {
    private historyPath: string;
    private includeManager?: IncludeManager;
    private _onIncludePatternsChanged = new vscode.EventEmitter<void>();
    readonly onIncludePatternsChanged = this._onIncludePatternsChanged.event;
    private _onUnregisteredFilesFound = new vscode.EventEmitter<void>();
    readonly onUnregisteredFilesFound = this._onUnregisteredFilesFound.event;
    private fileWatcher?: vscode.FileSystemWatcher;
    private cachedHistoryFiles: HistoryEntry[] = [];

    constructor() {
        // Get appropriate path based on platform
        this.historyPath = process.platform === 'win32' 
            ? path.join(process.env.APPDATA!, 'Cursor', 'User', 'History')
            : process.platform === 'darwin'
                ? path.join(process.env.HOME!, 'Library', 'Application Support', 'Cursor', 'User', 'History')
                : path.join(process.env.HOME!, '.config', 'Cursor', 'User', 'History');
    }

    async initialize(workspaceRoot: string): Promise<void> {
        this.includeManager = new IncludeManager(workspaceRoot);
        await this.includeManager.initialize();
        this.includeManager.onPatternsChanged(() => this._onIncludePatternsChanged.fire());
        
        // Setup file watcher for included patterns
        this.updateFileWatcher(workspaceRoot);
    }

    private updateFileWatcher(workspaceRoot: string): void {
        this.fileWatcher?.dispose();
        
        const patterns = this.includeManager?.getPatterns() ?? [];
        if (patterns.length > 0) {
            this.fileWatcher = vscode.workspace.createFileSystemWatcher(
                new vscode.RelativePattern(workspaceRoot, `{${patterns.join(',')}}`),
                false, // Don't ignore creates
                true,  // Ignore changes
                true   // Ignore deletes
            );
            
            this.fileWatcher.onDidCreate((uri) => {
                if (!uri.fsPath.includes(".groupedhistoryinclude") && !this.cachedHistoryFiles.some(entry => entry.filePath === uri.fsPath)) {
                    this._onUnregisteredFilesFound.fire();
                }
            });
        }
    }

    async readHistoryFiles(workspaceRoot: string): Promise<HistoryEntry[]> {
        this.cachedHistoryFiles = await this.readHistoryFilesInternal(workspaceRoot);
        return this.cachedHistoryFiles;
    }

    private async readHistoryFilesInternal(workspaceRoot: string): Promise<HistoryEntry[]> {
        const entries: HistoryEntry[] = [];
        
        if (!this.includeManager) {
            await this.initialize(workspaceRoot);
        }

        try {
            // First pass: only read entries.json to build metadata
            const dirs = await fs.readdir(this.historyPath);
            const entriesMetadata: Array<{
                dir: string,
                resource: string,
                entries: Array<{id: string, timestamp: number}>
            }> = [];
            
            for (const dir of dirs) {
                const dirPath = path.join(this.historyPath, dir);
                const entriesJsonPath = path.join(dirPath, 'entries.json');
                
                try {
                    // First try to read entries.json
                    const entriesJson: EntriesJson = JSON.parse(
                        await fs.readFile(entriesJsonPath, 'utf-8')
                    );
                    
                    const fileUri = vscode.Uri.parse(entriesJson.resource);
                    if (fileUri.fsPath.startsWith(workspaceRoot) && 
                        this.includeManager?.shouldInclude(fileUri.fsPath, workspaceRoot)) {
                        
                        // Get all files in the directory
                        const files = await fs.readdir(dirPath);
                        const allEntries = [...entriesJson.entries];

                        // Check for files not in entries.json
                        for (const file of files) {
                            if (file === 'entries.json') continue;
                            
                            // If this file isn't in entries.json (new saves does not get added to entries.json before VSCode exit), add it
                            if (!entriesJson.entries.some(entry => entry.id === file)) {
                                const filePath = path.join(dirPath, file);
                                const stats = await fs.stat(filePath);
                                
                                allEntries.push({
                                    timestamp: stats.mtime.getTime(),
                                    id: file,
                                });
                            }
                        }

                        entriesMetadata.push({
                            dir,
                            resource: entriesJson.resource,
                            entries: allEntries
                        });
                    }
                } catch (e) {
                    continue;
                }
            }

            // Sort by timestamp first to get newest changes
            const sortedEntries = entriesMetadata
                .flatMap(meta => meta.entries.map(e => ({...e, dir: meta.dir, resource: meta.resource})))
                .sort((a, b) => b.timestamp - a.timestamp);

            // Now load content only for entries we'll display
            for (const entry of sortedEntries) {
                const historyFilePath = path.join(this.historyPath, entry.dir, entry.id);
                
                entries.push({
                    timestamp: new Date(entry.timestamp),
                    historyFilePath,
                    dir: entry.dir,
                    filePath: vscode.Uri.parse(entry.resource).fsPath
                });
            }
        } catch (error) {
            console.error('Error reading history files:', error);
            return [];
        }

        return entries;
    }

    async findHistoryEntriesWithChangesAfterTimestamp(timestamp: Date): Promise<{filePath: string, entry: HistoryEntry | undefined}[] | undefined> {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
        if (!workspaceRoot) {
            return;
        }

        // Get all history entries for current workspace
        const allHistoryEntries = await this.readHistoryFiles(workspaceRoot);


        // Group entries by file path
        const fileEntries = new Map<string, HistoryEntry[]>();
        allHistoryEntries.forEach(entry => {
            const entries = fileEntries.get(entry.filePath) || [];
            entries.push(entry);
            fileEntries.set(entry.filePath, entries);
        });

        // Get all files that have changes after our timestamp
        const filesToRestore: {filePath: string, entry: HistoryEntry | undefined}[] = [];
        for (const [filePath, history] of fileEntries.entries()) {
            history.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
            // Check if there are any entries after timestamp
            if (history.some(e => e.timestamp.getTime() > timestamp.getTime())) {
                // Find the latest entry before timestamp
                const latestBeforeTimestamp = history.find(e => e.timestamp.getTime() <= timestamp.getTime());
                if (latestBeforeTimestamp) {
                    filesToRestore.push({filePath: filePath, entry: latestBeforeTimestamp});
                } else {
                    // If there are no entries before timestamp, add an undefined entry, so we can remove its contents
                    filesToRestore.push({filePath: filePath, entry: undefined});
                }
            }
        }

        // For each file that needs restoring, get the latest version before timestamp
        return filesToRestore;
    }   
    getHistoryPath(): string {
        return this.historyPath;
    }

    dispose(): void {
        this._onIncludePatternsChanged.dispose();
        this._onUnregisteredFilesFound.dispose();
        this.fileWatcher?.dispose();
        this.includeManager?.dispose();
    }

    getIncludePatterns(): string[] {
        return this.includeManager?.getPatterns() ?? [];
    }

    async loadContent(entry: HistoryEntry): Promise<string> {
        if (entry.content) return entry.content;
        
        try {
            const content = await fs.readFile(entry.historyFilePath, 'utf-8');
            entry.content = content;  // Cache the content
            return content;
        } catch (error) {
            console.error('Error loading file content:', error);
            return '';
        }
    }

    async loadPreviousEntry(entry: HistoryEntry): Promise<HistoryEntry | undefined> {
        try {
            const dirPath = path.join(this.historyPath, entry.dir);
            const entriesJsonPath = path.join(dirPath, 'entries.json');
            const entriesJson: EntriesJson = JSON.parse(
                await fs.readFile(entriesJsonPath, 'utf-8')
            );
            
            // Get all files in directory and their stats
            const files = await fs.readdir(dirPath);
            const allEntries = [...entriesJson.entries];
            
            // Add files not in entries.json
            for (const file of files) {
                if (file === 'entries.json') continue;
                if (!entriesJson.entries.some(e => e.id === file)) {
                    const stats = await fs.stat(path.join(dirPath, file));
                    allEntries.push({
                        id: file,
                        timestamp: stats.mtime.getTime(),
                    });
                }
            }
            
            // Sort by timestamp, ascending
            allEntries.sort((a, b) => a.timestamp - b.timestamp);
            
            const currentIndex = allEntries.findIndex(e => 
                path.join(dirPath, e.id) === entry.historyFilePath
            );
            
            if (currentIndex > 0) {
                const prevEntry = allEntries[currentIndex - 1];
                const prevPath = path.join(dirPath, prevEntry.id);
                return {
                    timestamp: new Date(prevEntry.timestamp),
                    historyFilePath: prevPath,
                    dir: entry.dir,
                    filePath: entry.filePath
                };
            }
            
            return undefined;
        } catch (error) {
            console.error('Error loading previous content:', error);
            return undefined;
        }
    }

    async refresh(): Promise<void> {
        if (this.includeManager) {
            // Reload include patterns
            await this.includeManager.loadPatterns();
        }
    }
} 