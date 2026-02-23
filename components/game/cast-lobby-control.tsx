"use client";

import { Cast, CheckCircle2, Loader2, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const CAST_SCRIPT_ID = "google-cast-sdk";
const DEFAULT_CAST_NAMESPACE = "urn:x-cast:com.niches.lobby";

type CastConnectionState =
  | "disabled"
  | "loading"
  | "ready"
  | "connecting"
  | "connected"
  | "error";

type CastWindow = Window & {
  __onGCastApiAvailable?: (isAvailable: boolean) => void;
  cast?: {
    framework?: {
      CastContext?: {
        getInstance: () => CastContextLike;
      };
      CastContextEventType?: {
        SESSION_STATE_CHANGED: string;
      };
      SessionState?: {
        SESSION_ENDED?: string;
        SESSION_RESUMED?: string;
        SESSION_STARTED?: string;
        SESSION_START_FAILED?: string;
      };
    };
  };
  chrome?: {
    cast?: {
      AutoJoinPolicy?: {
        ORIGIN_SCOPED: string;
      };
    };
  };
};

type CastContextLike = {
  addEventListener: (
    eventType: string,
    listener: (event: CastSessionEventLike) => void,
  ) => void;
  getCurrentSession: () => CastSessionLike | null;
  removeEventListener?: (
    eventType: string,
    listener: (event: CastSessionEventLike) => void,
  ) => void;
  requestSession: () => Promise<void>;
  setOptions: (options: {
    autoJoinPolicy: string;
    receiverApplicationId: string;
  }) => void;
};

type CastSessionLike = {
  sendMessage: (namespace: string, data: unknown) => Promise<void>;
};

type CastSessionEventLike = {
  sessionState?: string;
};

interface CastLobbyControlProps {
  canStart: boolean;
  code: number;
  gameState: string;
  playerCount: number;
  timePerQuestion: number;
}

const CAST_APP_ID = process.env.NEXT_PUBLIC_CAST_APP_ID;
const CAST_NAMESPACE =
  process.env.NEXT_PUBLIC_CAST_NAMESPACE ?? DEFAULT_CAST_NAMESPACE;

function getCastContext(castWindow: CastWindow) {
  return castWindow.cast?.framework?.CastContext?.getInstance?.() ?? null;
}

function getCastSetupError(castWindow: CastWindow) {
  const context = getCastContext(castWindow);
  const autoJoinPolicy = castWindow.chrome?.cast?.AutoJoinPolicy?.ORIGIN_SCOPED;

  if (!context || !autoJoinPolicy || !CAST_APP_ID) {
    return "Chromecast setup is not ready.";
  }

  return null;
}

function getStateLabel(state: CastConnectionState) {
  switch (state) {
    case "connected":
      return "TV connected";
    case "connecting":
      return "Connecting";
    case "loading":
      return "Loading Cast SDK";
    case "ready":
      return "Ready to cast";
    case "disabled":
      return "Cast disabled";
    case "error":
      return "Cast error";
    default:
      return "Cast";
  }
}

export function CastLobbyControl({
  canStart,
  code,
  gameState,
  playerCount,
  timePerQuestion,
}: CastLobbyControlProps) {
  const [castState, setCastState] = useState<CastConnectionState>(() =>
    CAST_APP_ID ? "loading" : "disabled",
  );
  const [statusMessage, setStatusMessage] = useState<string>(() =>
    CAST_APP_ID
      ? "Loading Chromecast controls..."
      : "Set NEXT_PUBLIC_CAST_APP_ID to enable Chromecast.",
  );
  const sendLobbySnapshotRef = useRef<() => Promise<boolean>>(
    async () => false,
  );

  const sendLobbySnapshot = useCallback(async () => {
    if (typeof window === "undefined") {
      return false;
    }

    const castWindow = window as CastWindow;
    const context = getCastContext(castWindow);
    const session = context?.getCurrentSession();

    if (!session) {
      return false;
    }

    try {
      await session.sendMessage(CAST_NAMESPACE, {
        payloadType: "LOBBY_UPDATE",
        sentAt: new Date().toISOString(),
        version: 1,
        lobby: {
          canStart,
          code: String(code),
          gameState,
          playerCount,
          timePerQuestion,
        },
      });

      return true;
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Could not update the Chromecast receiver.";
      setCastState("error");
      setStatusMessage(message);
      return false;
    }
  }, [canStart, code, gameState, playerCount, timePerQuestion]);

  useEffect(() => {
    sendLobbySnapshotRef.current = sendLobbySnapshot;
  }, [sendLobbySnapshot]);

  useEffect(() => {
    if (!CAST_APP_ID || typeof window === "undefined") {
      return;
    }

    const castWindow = window as CastWindow;
    const contextEventType =
      castWindow.cast?.framework?.CastContextEventType?.SESSION_STATE_CHANGED;
    let removeSessionListener: (() => void) | undefined;

    const handleSessionStateChange = (event: CastSessionEventLike) => {
      const sessionState = event.sessionState;
      const frameworkState = castWindow.cast?.framework?.SessionState;

      if (
        sessionState === frameworkState?.SESSION_STARTED ||
        sessionState === frameworkState?.SESSION_RESUMED
      ) {
        setCastState("connected");
        setStatusMessage("Connected. Lobby code is now shared on TV.");
        void sendLobbySnapshotRef.current();
        return;
      }

      if (sessionState === frameworkState?.SESSION_ENDED) {
        setCastState("ready");
        setStatusMessage("Cast session ended.");
        return;
      }

      if (sessionState === frameworkState?.SESSION_START_FAILED) {
        setCastState("error");
        setStatusMessage("Could not start cast session.");
      }
    };

    const initializeCast = (isAvailable: boolean) => {
      if (!isAvailable) {
        setCastState("error");
        setStatusMessage("Chromecast is unavailable in this browser.");
        return;
      }

      const setupError = getCastSetupError(castWindow);
      if (setupError) {
        setCastState("error");
        setStatusMessage(setupError);
        return;
      }

      const context = getCastContext(castWindow);
      const autoJoinPolicy =
        castWindow.chrome?.cast?.AutoJoinPolicy?.ORIGIN_SCOPED;

      if (!context || !autoJoinPolicy || !CAST_APP_ID) {
        setCastState("error");
        setStatusMessage("Chromecast setup is not ready.");
        return;
      }

      context.setOptions({
        autoJoinPolicy,
        receiverApplicationId: CAST_APP_ID,
      });

      if (contextEventType) {
        context.addEventListener(contextEventType, handleSessionStateChange);
        removeSessionListener = () => {
          context.removeEventListener?.(
            contextEventType,
            handleSessionStateChange,
          );
        };
      }

      if (context.getCurrentSession()) {
        setCastState("connected");
        setStatusMessage("Connected. Lobby code is now shared on TV.");
        void sendLobbySnapshotRef.current();
      } else {
        setCastState("ready");
        setStatusMessage("Ready to cast lobby code.");
      }
    };

    castWindow.__onGCastApiAvailable = initializeCast;

    if (castWindow.cast?.framework) {
      initializeCast(true);
      return () => {
        removeSessionListener?.();
        if (castWindow.__onGCastApiAvailable === initializeCast) {
          castWindow.__onGCastApiAvailable = undefined;
        }
      };
    }

    const existingScript = document.getElementById(
      CAST_SCRIPT_ID,
    ) as HTMLScriptElement | null;

    if (!existingScript) {
      const script = document.createElement("script");
      script.id = CAST_SCRIPT_ID;
      script.src =
        "https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1";
      script.async = true;
      script.onerror = () => {
        setCastState("error");
        setStatusMessage("Could not load Chromecast SDK.");
      };
      document.head.append(script);
    }

    return () => {
      removeSessionListener?.();
      if (castWindow.__onGCastApiAvailable === initializeCast) {
        castWindow.__onGCastApiAvailable = undefined;
      }
    };
  }, []);

  useEffect(() => {
    if (castState !== "connected") {
      return;
    }

    void sendLobbySnapshot();
  }, [castState, sendLobbySnapshot]);

  const handleCastAction = async () => {
    if (!CAST_APP_ID || typeof window === "undefined") {
      return;
    }

    const castWindow = window as CastWindow;
    const setupError = getCastSetupError(castWindow);

    if (setupError) {
      setCastState("error");
      setStatusMessage(setupError);
      return;
    }

    const context = getCastContext(castWindow);

    if (!context) {
      setCastState("error");
      setStatusMessage("Chromecast setup is not ready.");
      return;
    }

    try {
      if (!context.getCurrentSession()) {
        setCastState("connecting");
        setStatusMessage("Pick a Chromecast device to share the lobby code.");
        await context.requestSession();
      }

      const synced = await sendLobbySnapshot();
      setCastState("connected");
      setStatusMessage(
        synced
          ? "Connected. Lobby code is now shared on TV."
          : "Connected to TV.",
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Cast session was cancelled.";
      setCastState("error");
      setStatusMessage(message);
    }
  };

  const isActionDisabled =
    castState === "loading" || castState === "connecting";

  return (
    <div className="w-full space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant={castState === "connected" ? "outline" : "default"}
          className="w-full rounded-full sm:w-auto"
          disabled={isActionDisabled || castState === "disabled"}
          onClick={() => {
            void handleCastAction();
          }}
        >
          {castState === "loading" || castState === "connecting" ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              {castState === "connecting" ? "Connecting..." : "Loading Cast..."}
            </>
          ) : (
            <>
              <Cast className="size-4" />
              {castState === "connected" ? "Sync to TV" : "Cast lobby code"}
            </>
          )}
        </Button>

        <Badge
          variant="outline"
          className="border-foreground/20 bg-white text-foreground/70"
        >
          {castState === "connected" ? (
            <CheckCircle2 className="size-3.5" />
          ) : castState === "error" ? (
            <TriangleAlert className="size-3.5" />
          ) : null}
          {getStateLabel(castState)}
        </Badge>
      </div>

      <p className="text-foreground/70 text-sm">{statusMessage}</p>
    </div>
  );
}
