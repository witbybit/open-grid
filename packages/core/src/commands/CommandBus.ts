interface GridCommand<T = any> {
	type: string;
	payload: T;
}

export type CommandHandler<T = any> = (payload: T) => void;

export class CommandBus {
	private handlers = new Map<string, Set<CommandHandler>>();

	public registerHandler<T = any>(type: string, handler: CommandHandler<T>): () => void {
		if (!this.handlers.has(type)) {
			this.handlers.set(type, new Set());
		}
		const set = this.handlers.get(type)!;
		set.add(handler as CommandHandler);

		return () => {
			set.delete(handler as CommandHandler);
			if (set.size === 0) {
				this.handlers.delete(type);
			}
		};
	}

	public dispatch<T = any>(command: GridCommand<T>): void {
		const set = this.handlers.get(command.type);
		if (set) {
			set.forEach((handler) => {
				try {
					handler(command.payload);
				} catch (e) {
					console.error(`CommandBus: Error executing handler for command "${command.type}"`, e);
				}
			});
		}
	}

	public clear(): void {
		this.handlers.clear();
	}
}
