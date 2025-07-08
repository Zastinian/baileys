import type { AuthenticationState } from "../Types";
export declare const useSQLAuthState: (folder: string) => Promise<{
    state: AuthenticationState;
    saveCreds: () => Promise<void>;
}>;
