export const DEFAULT_INCLUDE_CONTENT = `# Files to track with Grouped Timeline
# Add patterns for files you want included in the Grouped Timeline
# Use ! to exclude files/folders (anti-patterns)
# After changing this file, refresh the Grouped Timeline view to see the updates

# Track all files by default (commented out because it might be slow for large projects)
# *
# */**

# Common exclusions
!node_modules/**
!dist/**
!out/**
!build/**
!.git/**
!coverage/**
!.next/**
!.cache/**
!tmp/**
!temp/**

# Exclude common large/binary files
!*/**.exe
!*/**.dll
!*/**.zip
!*/**.tar
!*/**.gz
!*/**.rar
!*/**.7z
!*/**.iso
!*/**.bin
!*/**.log
`; 