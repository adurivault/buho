export type DataSourceMode = 'demo' | 'user';

export interface AppError {
    source: string;
    message: string;
}

export interface LoadingState {
    dbInitializing: boolean;
    parsingFile: boolean;
    spotifyGuideScrollTop: number;
}
