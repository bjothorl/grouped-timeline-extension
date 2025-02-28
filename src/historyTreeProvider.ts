import * as vscode from 'vscode';
import { HistoryReader } from './historyReader';
import { ChangeGrouper } from './changeGrouper';
import { GroupedChange, HistoryEntry, SearchQueryItem } from './types';
import * as path from 'path';

export class HistoryTreeProvider implements vscode.TreeDataProvider<GroupedChange | HistoryEntry | SearchQueryItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
    private fileWatcher?: vscode.FileSystemWatcher;
    private sortOrder: 'Newest First' | 'Oldest First' | 'Most Files Changed' | 'Fewest Files Changed' = 'Newest First';
    private fileCountFilter?: number;
    private hasRefreshed = false;
    private searchQuery: string = '';

    constructor(
        private historyReader: HistoryReader,
        private changeGrouper: ChangeGrouper
    ) {
        // Listen for include pattern changes
        historyReader.onIncludePatternsChanged(() => {
            this.refresh();
        });

        historyReader.onUnregisteredFilesFound(() => {
            this.refresh();
        });
    }

    async refresh(): Promise<void> {
        this.hasRefreshed = true;
        // Reload include patterns and history
        await this.historyReader.refresh();
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: GroupedChange | HistoryEntry | SearchQueryItem): vscode.TreeItem {
        if ('isSearchQuery' in element) {
            const treeItem = new vscode.TreeItem(element.summary);
            treeItem.collapsibleState = vscode.TreeItemCollapsibleState.None;
            
            // If this is a search indicator, create a special label with clear button
            if (element.summary.includes('🔍')) {
                treeItem.label = {
                    label: `🔍 Search: "${this.searchQuery}"`,
                };
                treeItem.contextValue = 'searchIndicator'; // Used for command enablement
                treeItem.command = {
                    command: 'groupedHistory.search',
                    title: 'Change search query'
                };
            }
            
            return treeItem;
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

    async setSearchQuery(query: string) {
        this.searchQuery = query.toLowerCase();
        this.refresh();
    }

    private itemMatchesSearch(element: GroupedChange): boolean {
        return element.files.some(file => 
            path.basename(file).toLowerCase().includes(this.searchQuery)
        );
    }

    async getChildren(element?: GroupedChange | HistoryEntry | SearchQueryItem): Promise<(GroupedChange | HistoryEntry | SearchQueryItem)[] | undefined> {
        if (!element) {
            if (!this.hasRefreshed) {
                return [];
            }

            const items: (GroupedChange | HistoryEntry | SearchQueryItem)[] = [];
            
            // Add search query indicator if there's an active search
            if (this.searchQuery) {
                items.push({
                    timestamp: new Date(),
                    files: [],
                    changes: [],
                    summary: `🔍\tSearch: "${this.searchQuery}"`,
                    isSearchQuery: true,
                    command: {
                        command: 'groupedHistory.search',
                        title: 'Change search query'
                    }
                });
            }

            const entries = await this.historyReader.readHistoryFiles();
            let groups = this.changeGrouper.groupChanges(entries);

            // Apply search filter
            if (this.searchQuery) {
                groups = groups.filter(group => ('changes' in group && this.itemMatchesSearch(group) || 'isSearchQuery' in group));
            }

            // Apply file count filter if set
            if (this.fileCountFilter !== undefined) {
                const fileCount = this.fileCountFilter;
                groups = groups.filter(group => group.files.length >= fileCount);
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

        // Show changes when opening a group
        if ('changes' in element) { 
            return element.changes;
        }

        return undefined;
    }

    dispose(): void {
        this.fileWatcher?.dispose();
        this._onDidChangeTreeData.dispose();
    }
} 