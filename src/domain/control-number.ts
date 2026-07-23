/** ISA/GS/ST counter kinds minted per EDI Config during outbound generation. */
export type ControlNumberKind = "isa" | "gs" | "st";

/** Minted ISA/GS/ST control numbers for one outbound interchange. */
export interface ControlNumbers {
  isa: string;
  gs: string;
  st: string;
}
