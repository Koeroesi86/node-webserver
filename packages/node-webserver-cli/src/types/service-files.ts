export interface ServiceFiles {
  /** where the definition goes */
  filePath: string;
  /** the folder to create first, when it may not exist yet */
  folder?: string;
  /** what goes into it */
  content: string;
  /** the commands that load it, and unload it */
  install: string[][];
  /** to run before remove, a failure of them is nothing to stop */
  stop: string[][];
  remove: string[][];
  /** to run after the file is gone */
  afterRemove: string[][];
}
