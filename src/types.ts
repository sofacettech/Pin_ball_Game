export type XYZ = [number, number, number];
export interface Manifest {
 asset_revision:string;asset_checksums:Record<string,string>;
 additional_supports?:{matrix_inverse:number[][];width:number;rear:number;front:number;flat_end:number;height:number;lip:number}[];
 cave?:{root_matrix:number[][];matrix_inverse:number[][];world_scale:number;entry_plane:number;hold_local:number;approach_front:number;capture_half_width_local:number;inner_clear_diameter_source:number;clearance_ratio:number};
}
export interface TargetDefinition {id:string;score:number;initial_slot:string;initial_position:XYZ;bounds_local:[XYZ,XYZ];placements:{slot:string;surface:string;position:XYZ;safe:boolean;blocked_by:string[]}[]}
export interface Entity {game_id:string;role:string;anchor_world:XYZ;score_delta:number|null;details:Record<string,any>}
export interface Manifest {launcher_route:{points:XYZ[];edges:[XYZ[],XYZ[]];width_metres:number;source_sha256:string};passive_blockers:{id:string;hull_world:number[];triangles:number[];score_delta:number;powered:boolean;collision_in_static_mesh?:boolean;restitution?:number;rebound_direction_world?:XYZ;escape_edge_world:[XYZ,XYZ]}[];rail_route:RailRoute;static_collision_ranges:{name:string;start:number;count:number}[];runtime_contract_version:number;target_gameplay:TargetDefinition[];scale:number;model:string;groups:number;model_sha256:string;ball_diameter:number;entities:Entity[];static_collision_objects:{source_name:string;world_bounds:[XYZ,XYZ]}[];calibration:{authored_ball_spawn:XYZ;gravity_runtime:XYZ;spring:{rear_anchor_blender:XYZ;front_blender:XYZ;minimum_length_ratio:number;render_groups:string[]};paddles:{game_id:string;pivot_blender:XYZ;up_angle_degrees:number;collider_hull_vertices_local:XYZ[]}[]}}
export interface Reference {file:string;world_matrix:number[][];resolution:XYZ|number[];lens_mm:number;sensor_fit:string;sensor_width:number;sensor_height:number}

export interface RailRoute {id:string;points:XYZ[];entry_fractions:number[];exit_cyan_bumper_id:string;exit_contact_triangles:[XYZ,XYZ,XYZ][];exit_threshold_seconds:number}
