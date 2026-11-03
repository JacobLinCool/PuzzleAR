export type Pt = { x: number; y: number };

export interface RGBAImage {
	width: number;
	height: number;
	data: Uint8ClampedArray | Uint8Array;
}

/** Binary mask covering a region of interest inside a full frame. */
export interface MaskROI {
	left: number;
	top: number;
	width: number;
	height: number;
	/** Row-major, one byte per pixel, 0 or 1. */
	data: Uint8Array;
}

export type SideType = 'flat' | 'tab' | 'socket' | 'unknown';

export interface SideGeom {
	index: 0 | 1 | 2 | 3;
	type: SideType;
	/** Chord length in pixels. */
	length: number;
	/** Peak outward (positive) or inward (negative) displacement over length. */
	amplitude: number;
	/** 128 samples in side-local pixels: x along the chord, y outward. */
	pts: Pt[];
	/** 128 Lab triples sampled a few pixels inside the edge, flattened. */
	lab: number[];
	/** Color variation along the strip; low values make color evidence weak. */
	labSpread: number;
	/** 24 full-frame points along the side for highlighting. */
	framePts: Pt[];
	quality: 'ok' | 'review';
}

export interface PieceGeometry {
	area: number;
	centroid: Pt;
	/** Simplified full-frame outline for drawing. */
	outline: Pt[];
	/** Base corners, clockwise. Side k runs from corners[k] to corners[k+1]. */
	corners: [Pt, Pt, Pt, Pt];
	cornersOk: boolean;
	sides: [SideGeom, SideGeom, SideGeom, SideGeom];
	/** Problems a person should look at; empty means geometry looks sound. */
	issues: string[];
	/** Typical side length in pixels. */
	scale: number;
}

export type Rotation = 0 | 1 | 2 | 3;

export interface Placement {
	piece: number;
	row: number;
	col: number;
	/** Side k of the piece faces direction (k + rot) % 4; 0 top, 1 right, 2 bottom, 3 left. */
	rot: Rotation;
}

export type EdgeConfidence = 'strong' | 'check' | 'confirmed';

export interface BoardEdge {
	a: number;
	sideA: number;
	b: number;
	sideB: number;
	cost: number;
	confidence: EdgeConfidence;
	reason: string;
}

export interface SolverCandidate {
	objective: number;
	placements: Placement[];
	edges: BoardEdge[];
}

export interface HumanConstraint {
	id: string;
	type: 'fits' | 'doesnt_fit';
	a: number;
	sideA: number;
	b: number;
	sideB: number;
}

export interface Pin {
	piece: number;
	row: number;
	col: number;
	rot: Rotation;
}
