export interface HistoryEntry {
    timestamp: Date;
    content?: string;  // Optional, loaded on demand
    filePath: string;
    historyFilePath: string;  // Path to the history file
    dir: string;              // Directory containing the history file
}

export interface GroupedChange {
    timestamp: Date;
    files: string[];
    changes: HistoryEntry[];
    summary: string;
} 

export interface SearchQueryItem {
    summary: string;
    isSearchQuery: true;
    command?: {
        command: string;
        title: string;
    };
}