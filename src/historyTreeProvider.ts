import * as vscode from 'vscode';
import { HistoryReader } from './historyReader';
import { ChangeGrouper } from './changeGrouper';
import { GroupedChange, HistoryEntry, WarningItem } from './types';
import * as path from 'path';

export class HistoryTreeProvider implements vscode.TreeDataProvider<GroupedChange | HistoryEntry | WarningItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
    private fileWatcher?: vscode.FileSystemWatcher;
    private sortOrder: 'Newest First' | 'Oldest First' | 'Most Files Changed' | 'Fewest Files Changed' = 'Newest First';
    private fileCountFilter?: number;
    private hasRefreshed = false;
    private hasUnregisteredFiles = false;

    constructor(
        private historyReader: HistoryReader,
        private changeGrouper: ChangeGrouper
    ) {
        // Listen for include pattern changes
        historyReader.onIncludePatternsChanged(() => {
            this.updateFileWatcher();
            this.refresh();
        });

        historyReader.onUnregisteredFilesFound(() => {
            this.hasUnregisteredFiles = true;
            this.refresh();
        });

        // Initial file watcher setup
        this.updateFileWatcher();
    }

    private updateFileWatcher(): void {
        // Dispose old watcher if exists
        this.fileWatcher?.dispose();

        // Get current include patterns
        const patterns = this.historyReader.getIncludePatterns();
        if (patterns.length > 0) {
            // Create watcher for each pattern
            this.fileWatcher = vscode.workspace.createFileSystemWatcher(
                `{${patterns.join(',')}}`,
                false, // Don't ignore creates
                false, // Don't ignore changes
                false  // Don't ignore deletes
            );
            this.fileWatcher.onDidChange(() => this.refresh());
            this.fileWatcher.onDidCreate(() => this.refresh());
            this.fileWatcher.onDidDelete(() => this.refresh());
        }
    }

    async refresh(): Promise<void> {
        this.hasRefreshed = true;
        // Reload include patterns and history
        await this.historyReader.refresh();
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: GroupedChange | HistoryEntry): vscode.TreeItem {
        if ('isWarning' in element && 'summary' in element) {
            return {
                label: element.summary,
                collapsibleState: vscode.TreeItemCollapsibleState.None,
                contextValue: 'warning'
            };
        }
        if ('changes' in element) { // GroupedChange
            const relativeTime = this.getRelativeTimeString(element.timestamp);
            const dateTime = new Date(element.timestamp).toLocaleString(undefined, {
                dateStyle: 'medium',
                timeStyle: 'medium'
            });
            const fileList = element.files
                .map(file => `• ${path.relative(vscode.workspace.workspaceFolders![0].uri.fsPath, file)}`)
                .join('\n');
            const tooltip = `Changed files:\n${fileList}`;
            const fileText = element.files.length === 1 ? 'file' : 'files';
            return {
                label: `${element.files.length} ${fileText}\t`,
                description: `${dateTime}\t${relativeTime}`,
                tooltip: tooltip,
                collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
                contextValue: 'historyGroup'
            };
        } else { // HistoryEntry
            const time = new Date(element.timestamp).toLocaleTimeString(undefined, {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });
            return {
                label: path.basename(element.filePath),
                description: `${time} • ${path.relative(vscode.workspace.workspaceFolders![0].uri.fsPath, element.filePath)}`,
                collapsibleState: vscode.TreeItemCollapsibleState.None,
                contextValue: 'historyEntry',
                command: {
                    command: 'groupedHistory.preview',
                    title: 'Preview Version',
                    arguments: [element]
                }
            };
        }
    }

    private getRelativeTimeString(date: Date): string {
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMins / 60);
        const diffDays = Math.floor(diffHours / 24);

        if (diffMins < 1) return 'just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        if (diffDays < 30) return `${diffDays}d ago`;
        return date.toLocaleDateString();
    }

    async setFileCountFilter(count?: number) {
        this.fileCountFilter = count;
        this.refresh();
    }

    async setSortOrder(order: string) {
        this.sortOrder = order as any;
        this.refresh();
    }

    async getChildren(element?: GroupedChange | HistoryEntry | WarningItem): Promise<(GroupedChange | HistoryEntry | WarningItem)[] | undefined> {
        if (!element) {
            if (!this.hasRefreshed) {
                return [];
            }

            // Add warning message if unregistered files exist
            const items: (GroupedChange | HistoryEntry | WarningItem)[] = [];
            
            if (this.hasUnregisteredFiles) {
                return[{
                        timestamp: new Date(),
                        files: [],
                        changes: [],
                        summary: "⚠️\tNew file creation detected.",
                        isWarning: true
                    },{
                        timestamp: new Date(),
                        files: [],
                        changes: [],
                        summary: "\tRestart editor to see grouped timeline.",
                        isWarning: true
                    }
                ];
            }

            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders) return undefined;
            
            const entries = await this.historyReader.readHistoryFiles(workspaceFolders[0].uri.fsPath);
            let groups = this.changeGrouper.groupChanges(entries);

            // Apply file count filter if set
            if (this.fileCountFilter !== undefined) {
                groups = this.fileCountFilter === -1
                    ? groups.filter(group => group.files.length >= 3)
                    : groups.filter(group => group.files.length === this.fileCountFilter);
            }

            // Apply sort
            switch (this.sortOrder) {
                case 'Oldest First':
                    groups.reverse();
                    break;
                case 'Most Files Changed':
                    groups.sort((a, b) => b.files.length - a.files.length);
                    break;
                case 'Fewest Files Changed':
                    groups.sort((a, b) => a.files.length - b.files.length);
                    break;
                // 'Newest First' is default
            }

            return [...items, ...groups];
        }

        if ('changes' in element) { // GroupedChange
            return element.changes;
        }

        return undefined;
    }

    dispose(): void {
        this.fileWatcher?.dispose();
        this._onDidChangeTreeData.dispose();
    }
} 