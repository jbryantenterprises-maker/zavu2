export interface SelectedFile {
  file: File;
  icon: string;
}

export class FileHandler {
  private selectedFiles: File[] = [];

  handleFileSelect(files: FileList): SelectedFile[] {
    this.selectedFiles = Array.from(files);
    return this.selectedFiles.map(file => ({
      file,
      icon: this.getFileIcon(file)
    }));
  }

  handleDrop(e: DragEvent): SelectedFile[] {
    e.preventDefault();
    const files = Array.from(e.dataTransfer?.files || []);
    if (files.length > 0) {
      this.selectedFiles = files;
      return files.map(file => ({
        file,
        icon: this.getFileIcon(file)
      }));
    }
    return [];
  }

  private getFileIcon(file: File): string {
    if (file.type.includes('image')) return '🖼️';
    if (file.type.includes('video')) return '🎥';
    if (file.type.includes('audio')) return '🎵';
    if (file.type.includes('pdf')) return '📄';
    if (file.type.includes('zip') || file.type.includes('rar')) return '📦';
    return '📄';
  }

  getSelectedFiles(): File[] {
    return this.selectedFiles;
  }

  clearFiles(): void {
    this.selectedFiles = [];
  }

  getTotalSize(): number {
    return this.selectedFiles.reduce((acc, file) => acc + file.size, 0);
  }

  getFileMetadata() {
    return this.selectedFiles.map(file => ({
      name: file.name,
      size: file.size,
      mime: file.type || 'application/octet-stream'
    }));
  }
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
