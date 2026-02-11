const activeCards = new Set<string>();

export function isCardActive(cardId: string): boolean {
	return activeCards.has(cardId);
}

export function setCardActive(cardId: string): void {
	activeCards.add(cardId);
}

export function clearCardActive(cardId: string): void {
	activeCards.delete(cardId);
}

export function getActiveCardCount(): number {
	return activeCards.size;
}

export function clearAllActiveCards(): void {
	activeCards.clear();
}
