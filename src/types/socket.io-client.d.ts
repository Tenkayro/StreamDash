declare module "socket.io-client" {
  export interface Socket {
    close(): void;
    emit(event: string, payload?: unknown): Socket;
    on(event: string, listener: (...args: never[]) => void): Socket;
  }

  interface SocketOptions {
    forceNew?: boolean;
    reconnection?: boolean;
    reconnectionAttempts?: number;
    reconnectionDelay?: number;
    reconnectionDelayMax?: number;
    timeout?: number;
    transports?: string[];
    upgrade?: boolean;
    query?: Record<string, string>;
  }

  export default function io(url: string, options?: SocketOptions): Socket;
}
