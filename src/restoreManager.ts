import * as vscode from 'vscode';
import { HistoryEntry } from './types';
import * as path from 'path';
import { HistoryReader } from './historyReader';
import { GroupedChange } from './types';

export class RestoreManager {
    private historyReader: HistoryReader;

    constructor(historyReader: HistoryReader) {
        this.historyReader = historyReader;
    }

    async restoreVersion(entry: HistoryEntry): Promise<void> {
        const content = await this.historyReader.loadContent(entry);
        const uri = vscode.Uri.file(entry.filePath);
        
        try {
            // Try to open existing file
            await vscode.workspace.fs.stat(uri);
        } catch {
            // File doesn't exist, create it first
            await vscode.workspace.fs.writeFile(uri, Buffer.from(''));
        }

        const document = await vscode.workspace.openTextDocument(uri);
        const edit = new vscode.WorkspaceEdit();
        
        // Replace the content of the file
        edit.replace(
            uri,
            new vscode.Range(
                document.lineAt(0).range.start,
                document.lineAt(document.lineCount - 1).range.end
            ),
            content
        );
        
        await vscode.workspace.applyEdit(edit);
    }

    async removeContentOfFile(filePath: string): Promise<void> {
        const uri = vscode.Uri.file(filePath);
        const document = await vscode.workspace.openTextDocument(uri);
        const edit = new vscode.WorkspaceEdit();
        edit.replace(uri, new vscode.Range(
            document.lineAt(0).range.start,
            document.lineAt(document.lineCount - 1).range.end
        ), '');
        await vscode.workspace.applyEdit(edit);
    }

    async deleteFile(filePath: string): Promise<void> {
        const uri = vscode.Uri.file(filePath);
        await vscode.workspace.fs.delete(uri);
    }

    async previewVersion(entry: HistoryEntry): Promise<void> {
        const beforeUri = vscode.Uri.parse(`history-diff-before://${entry.filePath}.${entry.timestamp.getTime()}`);
        const currentUri = vscode.Uri.parse(`history-diff-current://${entry.filePath}.${entry.timestamp.getTime()}`);

        const beforeRegistration = vscode.workspace.registerTextDocumentContentProvider('history-diff-before', {
            provideTextDocumentContent: async () => {
                const prevEntry = await this.historyReader.loadPreviousEntry(entry);
                return prevEntry ? await this.historyReader.loadContent(prevEntry) : 'No previous version available';
            }
        });

        const currentRegistration = vscode.workspace.registerTextDocumentContentProvider('history-diff-current', {
            provideTextDocumentContent: async () => this.historyReader.loadContent(entry)
        });

        await vscode.commands.executeCommand('vscode.diff',
            beforeUri,
            currentUri,
            `History: ${path.basename(entry.filePath)} (${new Date(entry.timestamp).toLocaleString()})`
        );

        beforeRegistration.dispose();
        currentRegistration.dispose();
    }

    private async checkUnsavedFiles(entryFilePaths: string[], timestamp: Date, isAllFiles: boolean = false): Promise<boolean> {
        const unsavedFiles = [];
        for (const entryFilePath of entryFilePaths) {
            const doc = vscode.workspace.textDocuments.find(
                d => d.uri.fsPath === entryFilePath && d.isDirty
            );
            if (doc) {
                unsavedFiles.push(path.basename(entryFilePath));
            }
        }

        if (unsavedFiles.length > 0) {
            const scope = isAllFiles ? 'ALL workspace files' : 'selected files';
            const message = unsavedFiles.length === 1
                ? `File ${unsavedFiles[0]} has unsaved changes.\nThis will restore ${scope} to their state at ${new Date(timestamp).toLocaleString()}`
                : `${unsavedFiles.length} files have unsaved changes.\nThis will restore ${scope} to their state at ${new Date(timestamp).toLocaleString()}`;

            const choice = await vscode.window.showWarningMessage(
                message,
                { modal: true },
                'Save and Continue',
                'Discard Changes'
            );

            if (choice === 'Save and Continue') {
                await vscode.workspace.saveAll();
            } else if (!choice) {
                return false;
            }
        }

        return true;
    }

    private async confirmAllFilesRestore(entryFilePaths: string[], group: GroupedChange, timestamp: Date, isAfterVersion: boolean): Promise<boolean> {
        const timeStr = new Date(timestamp).toLocaleString();
        
        // Split files into group files and other files
        const groupFiles = entryFilePaths
            .filter(entry => group.files.includes(entry))
            .map(entry => vscode.workspace.workspaceFolders?.[0] 
                ? path.relative(vscode.workspace.workspaceFolders[0].uri.fsPath, entry)
                : entry);
        
        const otherFiles = entryFilePaths
            .filter(entry => !group.files.includes(entry))
            .map(entry => vscode.workspace.workspaceFolders?.[0] 
                ? path.relative(vscode.workspace.workspaceFolders[0].uri.fsPath, entry)
                : entry);

        let message = `These files are going to be restored to ${isAfterVersion ? 'after' : 'before'} changes:\n`;
        if (groupFiles.length > 0) {
            message += `\n${groupFiles.join('\n')}\n`;
        }

        if (otherFiles.length > 0) {
            message += `\nThe following files have changes registered after ${timeStr} and will be restored to their state before:\n`;
            message += `\n${otherFiles.join('\n')}`;
        }

        const choice = await vscode.window.showInformationMessage(
            message,
            { modal: true },
            'Proceed with Restore'
        );

        return choice === 'Proceed with Restore';
    }

    async restoreGroupToBefore(group: GroupedChange): Promise<void> {
        if (!await this.checkUnsavedFiles(group.changes.map(e => e.filePath), group.timestamp)) {
            return;
        }

        for (const entry of group.changes) {
            const previousEntry = await this.historyReader.loadPreviousEntry(entry);
            
            if (previousEntry) {
                await this.restoreVersion(previousEntry);
            } else {
                // No previous version exists, empty the file through the editor
                await this.removeContentOfFile(entry.filePath);
            }
        }
    }

    async restoreGroupToAfter(group: GroupedChange): Promise<void> {
        if (!await this.checkUnsavedFiles(group.changes.map(e => e.filePath), group.timestamp)) {
            return;
        }

        for (const entry of group.changes) {
            // Restore to current version (shown on right in preview)
            await this.restoreVersion(entry);
        }
    }

    async restoreAllToBefore(group: GroupedChange): Promise<void> {
        // Find all entries with changes after the timestamp (this will include the files in the group)
        const filesToRestore = await this.historyReader.findHistoryEntriesWithChangesAfterTimestamp(group.timestamp);

        if (!filesToRestore) {
            return;
        }

        const filePaths = filesToRestore.map(e => e.filePath);

        // First show confirmation dialog
        if (!await this.confirmAllFilesRestore(filePaths, group, group.timestamp, false)) {
            return;
        }

        // Then check for unsaved files
        if (!await this.checkUnsavedFiles(filePaths, group.timestamp, true)) {
            return;
        }

        for (const file of filesToRestore) {
            const groupedFile = group.changes.find(f => f.filePath === file.filePath);
            if (groupedFile) {
                const previousEntry = await this.historyReader.loadPreviousEntry(groupedFile);
                if (previousEntry) {
                    await this.restoreVersion(previousEntry);
                } else {
                    // No previous version exists, empty the file through the editor
                    await this.removeContentOfFile(file.filePath);
                }
            } else {
                // Otherwise, restore the file to the previous version
                if (file.entry) {
                    await this.restoreVersion(file.entry);
                } else {
                    await this.removeContentOfFile(file.filePath);
                }
            }
        }
    }

    async restoreAllToAfter(group: GroupedChange): Promise<void> {
        const filesToRestoreToBefore = await this.historyReader.findHistoryEntriesWithChangesAfterTimestamp(group.timestamp);
        if (!filesToRestoreToBefore) {
            return;
        }

        const filePaths = filesToRestoreToBefore.map(e => e.filePath);

        // First show confirmation dialog
        if (!await this.confirmAllFilesRestore(filePaths, group, group.timestamp, true)) {
            return;
        }

        // Then check for unsaved files
        if (!await this.checkUnsavedFiles(filePaths, group.timestamp, true)) {
            return;
        }

        for (const file of filesToRestoreToBefore) {
            // If the file is in the current group, restore it to the version shown on right in preview
            const groupedFile = group.changes.find(f => f.filePath === file.filePath);
            if (groupedFile) {
                await this.restoreVersion(groupedFile);
            } else {
                // Otherwise, restore the file to the previous version
                if (file.entry) {
                    await this.restoreVersion(file.entry);
                } else {
                    await this.removeContentOfFile(file.filePath);
                }
            }
        }
    }
} 