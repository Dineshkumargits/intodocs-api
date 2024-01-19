import { ResponseHandler } from './utils/handlers';
import express from 'express';
import multer from 'multer';

export const uploadinMem = multer({
  storage: multer.memoryStorage(),
  // limits: {
  //   fileSize: MAX_UPLOAD_FILESIZE,
  // },
});

const router: express.Router = express.Router();
/* eslint-disable */
router.get('/', (req, res) => {
  res.send('Ok');
});

router.get('/hello', (req, res) => {
  ResponseHandler.response(res, 200, 'Ok for Hello', null);
});

module.exports = router;
