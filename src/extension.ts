import * as vscode from 'vscode';
import { HistoryReader } from './historyReader';
import { ChangeGrouper } from './changeGrouper';
import { RestoreManager } from './restoreManager';
import { HistoryTreeProvider } from './historyTreeProvider';
import { HistoryEntry } from './types';

export function activate(context: vscode.ExtensionContext) {
    const historyReader = new HistoryReader();
    const changeGrouper = new ChangeGrouper();
    const restoreManager = new RestoreManager(historyReader);
    
    const treeProvider = new HistoryTreeProvider(historyReader, changeGrouper);
    const treeView = vscode.window.createTreeView('groupedHistory', { 
        treeDataProvider: treeProvider 
    });

    context.subscriptions.push(
        treeView,
        treeProvider,
        vscode.commands.registerCommand('groupedHistory.filterByFiles', async () => {
            const items = [
                { label: 'Show all file changes', description: 'No filter', count: undefined },
                { label: '2+ file changes', description: '2+ files', count: 2 },
                { label: '5+ file changes', description: '5+ files', count: 5 },
                { label: '10+ file changes', description: '10+ files', count: 10 },
                { label: '50+ file changes', description: '50+ files', count: 50 },
            ];
            
            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Filter by number of files changed'
            });

            if (selected) {
                switch(selected.label) {
                    case 'Show all file changes':
                        await treeProvider.setFileCountFilter(undefined);
                        break;
                    case '2+ file changes':
                        await treeProvider.setFileCountFilter(2);
                        break;
                    case '5+ file changes':
                        await treeProvider.setFileCountFilter(5);
                        break;
                    case '10+ file changes':
                        await treeProvider.setFileCountFilter(10);
                        break;
                    case '50+ file changes':
                        await treeProvider.setFileCountFilter(50);
                        break;
                }
            }
        }),
        vscode.commands.registerCommand('groupedHistory.refresh', async () => 
            await treeProvider.refresh()
        ),
        vscode.commands.registerCommand('groupedHistory.restore', (entry) => 
            restoreManager.restoreVersion(entry)
        ),
        vscode.commands.registerCommand('groupedHistory.preview', (entry) => 
            restoreManager.previewVersion(entry)
        ),
        vscode.commands.registerCommand('groupedHistory.restoreGroupToBefore', (group) => 
            restoreManager.restoreGroupToBefore(group)
        ),
        vscode.commands.registerCommand('groupedHistory.restoreGroupToAfter', (group) => 
            restoreManager.restoreGroupToAfter(group)
        ),
        vscode.commands.registerCommand('groupedHistory.restoreAllToBefore', (group) => 
            restoreManager.restoreAllToBefore(group)
        ),
        vscode.commands.registerCommand('groupedHistory.restoreAllToAfter', (group) => 
            restoreManager.restoreAllToAfter(group)
        ),
        vscode.commands.registerCommand('groupedHistory.restoreFileToBefore', async (entry: HistoryEntry) => {
            const previousEntry = await historyReader.loadPreviousEntry(entry);
            if (previousEntry) {
                await restoreManager.restoreVersion(previousEntry);
            } else {
                await restoreManager.removeContentOfFile(entry.filePath);
            }
        }),
        vscode.commands.registerCommand('groupedHistory.restoreFileToAfter', (entry: HistoryEntry) => 
            restoreManager.restoreVersion(entry)
        ),
        vscode.commands.registerCommand('groupedHistory.sort', async () => {
            const items = [
                { label: 'Newest First', description: 'Default' },
                { label: 'Oldest First' },
                { label: 'Most Files Changed' },
                { label: 'Fewest Files Changed' }
            ];
            
            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Sort history by...'
            });

            if (selected) {
                await treeProvider.setSortOrder(selected.label);
            }
        }),
        vscode.commands.registerCommand('groupedHistory.timeWindow', async () => {
            const items = [
                { label: '2 seconds', description: 'Very tight grouping' },
                { label: '5 seconds', description: 'Default' },
                { label: '10 seconds', description: 'Loose grouping' },
                { label: '30 seconds', description: 'Very loose grouping' },
                { label: '1 minute', description: 'Session-like grouping' }
            ];
            
            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select time window for grouping changes'
            });

            if (selected) {
                let seconds = 5;  // default
                if (selected.label === '2 seconds') seconds = 2;
                if (selected.label === '10 seconds') seconds = 10;
                if (selected.label === '30 seconds') seconds = 30;
                if (selected.label === '1 minute') seconds = 60;
                
                changeGrouper.setTimeWindow(seconds);
                treeProvider.refresh();
            }
        }),

    );
} 