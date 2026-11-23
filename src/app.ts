import { env } from './config/env.ts';
import express, { type Express, type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { router } from './routes/index.ts';
import { errorHandler } from './middlewares/errorHandler.ts';

/** The Express app without `listen`, so tests can drive it with supertest. Started by `server.ts`. */
export const app: Express = express();

app.disable('x-powered-by');
app.set('trust proxy', env.TRUST_PROXY);

app.use(cors({ origin: env.CORS_ORIGINS, credentials: true }));
app.use(express.json({ limit: '10kb' }));
app.use(cookieParser());

app.get('/health', (req: Request, res: Response) => {
    res.send('Hello, World!');
});

app.use('/api', router);
app.use(errorHandler);
