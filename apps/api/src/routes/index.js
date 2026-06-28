"use strict";

const express = require("express");
const router = express.Router(); // 🟢 Khai báo router ở đây (Duy nhất 1 lần)

// Import các controller (Đi lùi ra ngoài thư mục routes rồi đi vào controllers)
const loggerController = require("../controllers/loggerController");
const mappingController = require("../controllers/mappingController");
const alertController = require("../controllers/alertController");
const telegramController = require("../controllers/telegramController");

// Định tuyến thành phần phía sau
router.get("/logger/latest/raw", loggerController.getLatestDataRaw);
router.get("/logger/latest/grouped", loggerController.getLatestDataGrouped);
router.get('/logger/:logger_id/tags', alertController.getTagsByLogger);
router.post('/logger/alerts/config', alertController.saveAlertThreshold);

// API phục vụ UI
router.get("/mappings/helpers", mappingController.getMappingHelpers);
router.get("/mappings/station-tags/:station_id", mappingController.getStationTags);
router.post("/mappings", mappingController.createMapping);
router.delete("/mappings/:id", mappingController.deleteMapping);

// Route phục vụ Chart & Gauge màn hình giám sát trung tâm
router.get("/logger/history", loggerController.getHistoryData);
router.get("/logger/gauge/:station_id", loggerController.getGaugeData);


// 🟢 ROUTE MỚI THÊM VÀO ĐÂY:
router.get("/analytics/flow-by-license", loggerController.getFlowAnalyticsByLicense);


// Đồng bộ URL API Cảnh Báo
router.get("/logger/:logger_id/tags", alertController.getTagsByLogger);
router.post("/logger/alerts/config", alertController.saveAlertThreshold);


// Telegram config
router.get( "/telegram/config", telegramController.getTelegramConfig);
router.post("/telegram/config", telegramController.saveTelegramConfig);
router.post("/telegram/test",   telegramController.testTelegramConfig);

// Xuất router ra để server.js sử dụng
module.exports = router;