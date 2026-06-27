"use strict";

const express = require("express");
const router = express.Router(); // 🟢 Khai báo router ở đây (Duy nhất 1 lần)

// Import các controller (Đi lùi ra ngoài thư mục routes rồi đi vào controllers)
const loggerController = require("../controllers/loggerController");
const mappingController = require("../controllers/mappingController");

// Định tuyến thành phần phía sau
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

// Xuất router ra để server.js sử dụng
module.exports = router;