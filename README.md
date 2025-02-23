# Grouped Timeline: Local History Restore Manager for VS Code!

A VS Code extension that groups near-simultaneous changes in your local timeline, allowing you to restore grouped or individual files to any previous save point - much like JetBrains Rider's Local History feature.

## No previous install necessary, works retroactively!
Can't figure out exactly which files changed (and how) yesterday? No problem! This extension will tell you!

# Features
- Groups timeline entries by time window
- Restores individual files or groups of files
- Configurable file tracking through .groupedtimelineinclude
- Preview changes before restoring
- Sort by time or number of files changed

# How to first use:
1. Open the Grouped Timeline view in Explorer (under the built in Timeline view), and click the refresh icon
   ![Main View](https://github.com/bjothorl/grouped-timeline-extension/blob/master/images/how-to-1.png?raw=true)

2. A .groupedtimelineinclude file will be created in your workspace root. Open it.
   ![Main View](https://github.com/bjothorl/grouped-timeline-extension/blob/master/images/how-to-2.png?raw=true)

3. For most projects uncomment the **/* line in the .groupedtimelineinclude file.
   ![Main View](https://github.com/bjothorl/grouped-timeline-extension/blob/master/images/how-to-3.png?raw=true)

4. Use context menu to restore or preview versions
   ![Main View](https://github.com/bjothorl/grouped-timeline-extension/blob/master/images/how-to-4.png?raw=true)

# Screenshots

### Main Extension View
![Main View](https://github.com/bjothorl/grouped-timeline-extension/blob/master/images/screenshot.png?raw=true)

### Restore Options
![Restore Options](https://github.com/bjothorl/grouped-timeline-extension/blob/master/images/restore_options.png?raw=true)

### Timeline Groupings
![Timeline Groupings](https://github.com/bjothorl/grouped-timeline-extension/blob/master/images/groupings.png?raw=true)

### Configuration
![Configuration](https://github.com/bjothorl/grouped-timeline-extension/blob/master/images/config.png?raw=true)

# Source Code
This extension is open source and the code is available [here](https://github.com/bjothorl/grouped-timeline-extension).
_Feel free to contribute or report issues!_
