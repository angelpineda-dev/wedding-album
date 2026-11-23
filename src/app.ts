import { env } from './config/env.ts';
import express, { type Express, type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import { router } from './routes/index.ts';
import { errorHandler } from './middlewares/errorHandler.ts';

const app: Express = express();

app.disable('x-powered-by');
app.set('trust proxy', env.TRUST_PROXY);

app.use(express.json({ limit: '10kb' }));
app.use(cookieParser());

app.get('/health', (req: Request, res: Response) => {
    res.send('Hello, World!');
});

app.use('/api', router);
app.use(errorHandler);

app.listen(env.PORT, () => {
    console.log(`Server is running at http://localhost:${env.PORT}`);
});
