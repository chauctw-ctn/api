"use strict";

const express = require("express");
const router = express.Router();
const loggerController = require("./loggerController");
const mappingController = require("./mappingController");

//  ĐÚNG: Chỉ viết phần định tuyến thành phần phía sau
router.get("/logger/latest/raw", loggerController.getLatestDataRaw);
router.get("/logger/latest/grouped", loggerController.getLatestDataGrouped);
// API phục vụ UI
router.get("/mappings/helpers", mappingController.getMappingHelpers);
router.get("/mappings/station-tags/:station_id", mappingController.getStationTags);
router.post("/mappings", mappingController.createMapping);
router.delete("/mappings/:id", mappingController.deleteMapping);

// Route phục vụ Chart & Gauge màn hình giám sát trung tâm
router.get("/logger/history", loggerController.getHistoryData);
router.get("/logger/gauge/:station_id", loggerController.getGaugeData);

module.exports = router;