export interface LogFile {
  fd: number;
  /** where the next chunk goes. The files are written at a position, so a chunk that has to be written again lands where it was, not behind itself */
  offset: number;
  /** the chunk on its way to the disk */
  pending?: { data: Buffer; position: number };
}
