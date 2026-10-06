import { Router } from "express";

import { authenticateApiKey } from "../../Auth/middleware/authenticateApiKey";
import { KnowledgeBaseController } from "../Controller/knowledge-base.controller";

const router = Router();

const knowledgeBaseController = new KnowledgeBaseController();

router.post(
  "/",
  authenticateApiKey,
  knowledgeBaseController.create.bind(knowledgeBaseController),
);

router.get(
  "/",
  authenticateApiKey,
  knowledgeBaseController.list.bind(knowledgeBaseController),
);

router.get(
  "/:knowledgeBaseId",
  authenticateApiKey,
  knowledgeBaseController.get.bind(knowledgeBaseController),
);

router.delete(
  "/:knowledgeBaseId",
  authenticateApiKey,
  knowledgeBaseController.remove.bind(knowledgeBaseController),
);

router.post(
  "/:knowledgeBaseId/documents",
  authenticateApiKey,
  knowledgeBaseController.addDocument.bind(knowledgeBaseController),
);

export default router;
