interface GridCommand<T = any> {
	type: string;
	payload: T;
}

export type CommandHandler<T = any> = (payload: T) => void;

export class CommandBus {
	private handlers = new Map<string, Set<CommandHandler>>();
	private globalHandlers = new Set<CommandHandler<GridCommand>>();

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

	public registerGlobalHandler(handler: CommandHandler<GridCommand>): () => void {
		this.globalHandlers.add(handler);
		return () => {
			this.globalHandlers.delete(handler);
		};
	}

	public dispatch<T = any>(command: GridCommand<T>): void {
		// Dispatch to specific handlers
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

		// Dispatch to global interceptors (like plugins)
		this.globalHandlers.forEach((handler) => {
			try {
				handler(command);
			} catch (e) {
				console.error(`CommandBus: Error executing global handler for command "${command.type}"`, e);
			}
		});
	}

	public clear(): void {
		this.handlers.clear();
		this.globalHandlers.clear();
	}
}
