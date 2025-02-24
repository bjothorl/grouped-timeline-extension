import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { HistoryEntry } from './types';
import { IncludeManager } from './includeManager';
import { URI } from 'vscode-uri';
import { createHash } from 'crypto';

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
    
    private newFileHashes: Map<string, string> = new Map(); // hash -> filePath
    private unusedDirectories: Set<string> = new Set();


    constructor() {
        // Detect if running in Cursor or VS Code
        const isCursor = vscode.env.appName === 'Cursor';
        
        // Get appropriate path based on platform and editor
        if (isCursor) {
            this.historyPath = process.platform === 'win32' 
                ? path.join(process.env.APPDATA!, 'Cursor', 'User', 'History')
                : process.platform === 'darwin'
                    ? path.join(process.env.HOME!, 'Library', 'Application Support', 'Cursor', 'User', 'History')
                    : path.join(process.env.HOME!, '.config', 'Cursor', 'User', 'History');
        } else {
            // VS Code history paths
            this.historyPath = process.platform === 'win32'
                ? path.join(process.env.APPDATA!, 'Code', 'User', 'History')
                : process.platform === 'darwin'
                    ? path.join(process.env.HOME!, 'Library', 'Application Support', 'Code', 'User', 'History')
                    : path.join(process.env.HOME!, '.config', 'Code', 'User', 'History');
        }

        
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders) {
            this.initialize(workspaceFolders[0].uri.fsPath);
        }
        else {
            console.error('No workspace folders found');
        }
    }

    async initialize(workspaceRoot: string): Promise<void> {
        this.includeManager = new IncludeManager(workspaceRoot);
        await this.includeManager.loadPatterns();
        this.includeManager.onPatternsChanged(() => this._onIncludePatternsChanged.fire());
        
        // Setup file watcher for included patterns
        this.updateFileWatcher(workspaceRoot);
    }

    private updateFileWatcher(workspaceRoot: string): void {
        this.fileWatcher?.dispose();
        
        const { includes } = this.includeManager?.getPatterns() ?? { includes: [] };
        if (includes.length > 0) {
            this.fileWatcher = vscode.workspace.createFileSystemWatcher(
                new vscode.RelativePattern(workspaceRoot, `{${includes.join(',')}}`),
                false, // Don't ignore creates
                true,  // Ignore changes
                true   // Ignore deletes
            );
            
            this.fileWatcher.onDidCreate(async (uri) => {
                if (!uri.fsPath.includes(".groupedtimelineinclude") && 
                    !this.cachedHistoryFiles.some(entry => entry.filePath === uri.fsPath) &&
                    this.includeManager?.shouldInclude(uri.fsPath, workspaceRoot)) {
                    
                    this.registerNewFile(uri.fsPath);
                    this._onUnregisteredFilesFound.fire();
                }
            });
        }
    }

    async readHistoryFiles(): Promise<HistoryEntry[]> {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
        if (!workspaceRoot) {
            return [];
        }

        this.cachedHistoryFiles = await this.readHistoryWithAdditionalFileHashes(workspaceRoot);
        return this.cachedHistoryFiles;
    }

    private async readHistoryWithAdditionalFileHashes(workspaceRoot: string): Promise<HistoryEntry[]> {
        const entries: HistoryEntry[] = [];
        
        if (!this.includeManager) {
            await this.initialize(workspaceRoot);
        }
    
        try {
            // Read all directories in history path
            const dirs = await fs.readdir(this.historyPath);
            const processedDirs = new Set<string>();
    
            // First pass: Process entries.json to find known files
            for (const dir of dirs) {
                const dirPath = path.join(this.historyPath, dir);
                const entriesJsonPath = path.join(dirPath, 'entries.json');
                
                try {
                    // Try to read entries.json
                    const entriesJson: EntriesJson = JSON.parse(
                        await fs.readFile(entriesJsonPath, 'utf-8')
                    );
                    
                    const fileUri = vscode.Uri.parse(entriesJson.resource);
                    if (fileUri.fsPath.startsWith(workspaceRoot) && 
                        this.includeManager?.shouldInclude(fileUri.fsPath, workspaceRoot)) {
                        
                        processedDirs.add(dir);
                        
                        // Process entries as before
                        const files = await fs.readdir(dirPath);
                        const allEntries = [...entriesJson.entries];
    
                        for (const file of files) {
                            if (file === 'entries.json') continue;
                            
                            if (!entriesJson.entries.some(entry => entry.id === file)) {
                                const filePath = path.join(dirPath, file);
                                const stats = await fs.stat(filePath);
                                
                                allEntries.push({
                                    timestamp: stats.mtime.getTime(),
                                    id: file,
                                });
                            }
                        }
    
                        // Add entries to our result
                        for (const entry of allEntries) {
                            const historyFilePath = path.join(dirPath, entry.id);
                            entries.push({
                                timestamp: new Date(entry.timestamp),
                                historyFilePath,
                                dir,
                                filePath: fileUri.fsPath
                            });
                        }
                    } else {
                        // If the directory is not in the current workspace, add it to the unused directories
                        this.unusedDirectories.add(dir);
                    }

                } catch (e) {
                    // If entries.json doesn't exist or can't be read, add it to the unused directories
                    if (!processedDirs.has(dir)) {
                        this.unusedDirectories.add(dir);
                    }
                    continue;
                }
            }
    
            // Second pass: Check unused directories against our new file hashes
            for (const dir of this.unusedDirectories) {
                if (this.newFileHashes.has(dir)) {
                    const dirPath = path.join(this.historyPath, dir);
                    try {
                        const files = await fs.readdir(dirPath);
                        const filePath = this.newFileHashes.get(dir)!;
                        
                        // Process all history files in this directory
                        for (const historyFile of files) {
                            if (historyFile === 'entries.json') continue;
                            
                            const historyFilePath = path.join(dirPath, historyFile);
                            const stats = await fs.stat(historyFilePath);
                            
                            entries.push({
                                timestamp: new Date(stats.mtime),
                                historyFilePath,
                                dir,
                                filePath
                            });
                        }
                    } catch (error) {
                        console.error('Error processing unused directory:', error);
                    }
                }
            }
    
            // Sort entries by timestamp
            entries.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
            return entries;
    
        } catch (error) {
            console.error('Error reading history files:', error);
            return [];
        }
    }
    
    // Add a method to register new files
    public registerNewFile(filePath: string): void {
        const hash = this.hashFilePath(filePath);
        this.newFileHashes.set(hash, filePath);
    }

    private hashFilePath(filePath: string): string {
        // Convert to URI using VS Code's URI class
        const uri = URI.file(filePath);
        
        // Get string representation and hash it
        const uriString = uri.toString();
        const hash = this.hashString(uriString);
        
        // Convert to hex string, preserving negative sign if present
        return hash.toString(16);
    }
    
    // This function has been recreated from looking at the VSCode source code.
    private hashString(s: string): number {
        let hash = this.numberHash(149417, 0);  // Same initial prime as VS Code
        for (let i = 0; i < s.length; i++) {
            hash = this.numberHash(s.charCodeAt(i), hash);
        }
        return hash;
    }
    
    private numberHash(val: number, initialHashVal: number): number {
        return (((initialHashVal << 5) - initialHashVal) + val) | 0;  // Force 32-bit integer
    }

    async findHistoryEntriesWithChangesAfterTimestamp(timestamp: Date): Promise<{filePath: string, entry: HistoryEntry | undefined}[] | undefined> {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
        if (!workspaceRoot) {
            return;
        }

        // Get all history entries for current workspace
        const allHistoryEntries = await this.readHistoryFiles();


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

    getIncludePatterns(): { includes: string[], excludes: string[] } {
        return this.includeManager?.getPatterns() ?? { includes: [], excludes: [] };
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