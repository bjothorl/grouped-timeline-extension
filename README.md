# Grouped Timeline: Local History Restore Manager for VS Code!

A VS Code extension that groups near-simultaneous changes in your local timeline, allowing you to restore grouped or individual files to any previous save point - much like JetBrains Rider's Local History feature.

## No previous install necessary, works retroactively!
Can't figure out exactly which files changed (and how) yesterday? No problem! This extension will tell you!

![Main View](https://github.com/bjothorl/grouped-timeline-extension/blob/master/images/grouped-timeline.gif?raw=true)

# Features
- Groups timeline entries by time window
- Restores individual files or groups of files
- Configurable file tracking through .groupedtimelineinclude
- Preview changes before restoring (compared with next save, or with current version)
- Sort by time or number of files changed
- Search for specific files or groups of files

# How to first use
1. After installing the extension, a `.groupedtimelineinclude` file will be created in your workspace root. Open it.

![Include file](https://github.com/bjothorl/grouped-timeline-extension/blob/master/images/include-file-in-root.png?raw=true)

2. For most projects, uncomment the `**/*` and `*` lines in the file so it looks like this:

![Config settings](https://github.com/bjothorl/grouped-timeline-extension/blob/master/images/config-uncomment.png?raw=true)

3. Click the refresh icon in the Grouped Timeline view in Explorer (under the built in Timeline view) to refresh the timeline.

![Refresh](https://github.com/bjothorl/grouped-timeline-extension/blob/master/images/refresh-button.png?raw=true)

4. Use context menu to restore or preview versions

![Context Menu](https://github.com/bjothorl/grouped-timeline-extension/blob/master/images/context-menu.png?raw=true)

# Screenshots

### Main Extension View
![Main View](https://github.com/bjothorl/grouped-timeline-extension/blob/master/images/screenshot.png?raw=true)

### Restore Options
![Restore Options](https://github.com/bjothorl/grouped-timeline-extension/blob/master/images/restore_options.png?raw=true)

### Timeline Groupings
![Timeline Groupings](https://github.com/bjothorl/grouped-timeline-extension/blob/master/images/groupings.png?raw=true)

### Configuration
![Configuration](https://github.com/bjothorl/grouped-timeline-extension/blob/master/images/config.png?raw=true)

### Search
![Search](https://github.com/bjothorl/grouped-timeline-extension/blob/master/images/search.png?raw=true)

# Source Code
This extension is open source and the code is available [here](https://github.com/bjothorl/grouped-timeline-extension).
_Feel free to contribute or report issues!_