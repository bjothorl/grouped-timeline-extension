import { HistoryEntry, GroupedChange } from './types';

export class ChangeGrouper {
    private timeWindow = 5000;  // Default 5 seconds

    setTimeWindow(seconds: number) {
        this.timeWindow = seconds * 1000;
    }

    groupChanges(entries: HistoryEntry[]): GroupedChange[] {
        let groups: GroupedChange[] = [];
        let currentGroup: HistoryEntry[] = [];
        
        entries.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
        
        for (let i = 0; i < entries.length; i++) {
            if (currentGroup.length === 0) {
                currentGroup.push(entries[i]);
                continue;
            }

            const timeDiff = Math.abs(entries[i].timestamp.getTime() - 
                            currentGroup[0].timestamp.getTime());
            
            if (timeDiff <= this.timeWindow) {
                currentGroup.push(entries[i]);
            } else {
                groups.push(this.createGroup(currentGroup));
                currentGroup = [entries[i]];
            }
        }

        if (currentGroup.length > 0) {
            groups.push(this.createGroup(currentGroup));
        }

        // Sort groups by timestamp, newest first
        groups.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

        return groups;
    }

    private createGroup(entries: HistoryEntry[]): GroupedChange {
        const timestamp = entries[0].timestamp;
        const files = [...new Set(entries.map(e => e.filePath))];
        
        return {
            timestamp,
            files,
            changes: entries,
            summary: `Changed ${files.length} file${files.length > 1 ? 's' : ''}`
        };
    }
} 