export function formatGameState(
  gameState: "CREATE_QUESTIONS" | "PLAY" | "END_SCREEN",
) {
  switch (gameState) {
    case "CREATE_QUESTIONS":
      return "In lobby";
    case "PLAY":
      return "In game";
    case "END_SCREEN":
      return "Game ended";
  }
}
