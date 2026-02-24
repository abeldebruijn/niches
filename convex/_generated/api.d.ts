/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as game from "../game.js";
import type * as game_constants from "../game/constants.js";
import type * as game_helpers_authPlayer from "../game/helpers/authPlayer.js";
import type * as game_helpers_collections from "../game/helpers/collections.js";
import type * as game_helpers_lobby from "../game/helpers/lobby.js";
import type * as game_helpers_roundLifecycle from "../game/helpers/roundLifecycle.js";
import type * as game_helpers_validation from "../game/helpers/validation.js";
import type * as game_index from "../game/index.js";
import type * as game_internal from "../game/internal.js";
import type * as game_mutations_lobby from "../game/mutations/lobby.js";
import type * as game_mutations_play from "../game/mutations/play.js";
import type * as game_mutations_player from "../game/mutations/player.js";
import type * as game_mutations_questions from "../game/mutations/questions.js";
import type * as game_queries_end from "../game/queries/end.js";
import type * as game_queries_home from "../game/queries/home.js";
import type * as game_queries_lobby from "../game/queries/lobby.js";
import type * as game_queries_play from "../game/queries/play.js";
import type * as game_types from "../game/types.js";
import type * as http from "../http.js";
import type * as username from "../username.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  game: typeof game;
  "game/constants": typeof game_constants;
  "game/helpers/authPlayer": typeof game_helpers_authPlayer;
  "game/helpers/collections": typeof game_helpers_collections;
  "game/helpers/lobby": typeof game_helpers_lobby;
  "game/helpers/roundLifecycle": typeof game_helpers_roundLifecycle;
  "game/helpers/validation": typeof game_helpers_validation;
  "game/index": typeof game_index;
  "game/internal": typeof game_internal;
  "game/mutations/lobby": typeof game_mutations_lobby;
  "game/mutations/play": typeof game_mutations_play;
  "game/mutations/player": typeof game_mutations_player;
  "game/mutations/questions": typeof game_mutations_questions;
  "game/queries/end": typeof game_queries_end;
  "game/queries/home": typeof game_queries_home;
  "game/queries/lobby": typeof game_queries_lobby;
  "game/queries/play": typeof game_queries_play;
  "game/types": typeof game_types;
  http: typeof http;
  username: typeof username;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
