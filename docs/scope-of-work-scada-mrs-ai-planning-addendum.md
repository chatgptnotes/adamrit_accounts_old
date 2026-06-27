# Addendum to Scope of Work for SMAS/SCADA System at MRS-A Substation

## Purpose

This addendum shall be included in the existing Scope of Work for the Substation Monitoring and Automation System (SMAS) / SCADA system at 11 kV Main Receiving Substation (MRS-A S/S). It adds on-premises AI-based monitoring, CCTV smoke/fire detection, load forecasting, transformer oil temperature analytics, server specification, cybersecurity, testing, deliverables, and acceptance requirements.

All AI/ML processing shall be performed fully on-premises within the OFBA/substation network. No cloud-hosted AI, external internet service, or Jetson Orin edge device shall be used for normal operation.

## Recommended Placement in Existing Scope Document

Insert these sections after the existing SCADA network architecture/cybersecurity section and before the acceptance criteria. Update deliverables, testing, and warranty sections using the clauses below.

## 1. On-Premises AI Analytics and Application Server

The Firm shall provide an on-premises x86-based AI analytics and application server for Ampris backend, database, SCADA analytics, CCTV smoke/fire detection, load forecasting, transformer oil temperature monitoring, and anomaly detection.

The system shall not use cloud-hosted AI or external internet services for normal operation. All application data, SCADA history, CCTV analytics, AI model input/output, alarms, reports, and event logs shall remain within the OFBA premises network.

### 1.1 Main Server Specification

The main server shall meet or exceed the following specification:

| Component | Minimum / Recommended Specification |
| --- | --- |
| CPU | Intel Xeon Silver / Intel i9 / AMD EPYC, minimum 16 cores / 24 threads |
| RAM | 128 GB ECC recommended, 64 GB minimum |
| GPU | NVIDIA RTX 4070 Ti Super 16 GB minimum recommended; NVIDIA L4 24 GB preferred for server-grade deployment |
| OS Disk | 2 x 1 TB NVMe SSD in RAID 1 |
| DB/App Disk | 4 x 2 TB enterprise SSD in RAID 10 |
| Network | 2 x 1GbE minimum, 10GbE recommended |
| Power | Redundant power supply preferred |
| UPS | Online UPS with minimum 60 minutes backup |
| Form Factor | Rack server or industrial-grade server cabinet |

### 1.2 Operating System and Software

The preferred operating system shall be Ubuntu Server 24.04 LTS. The server shall include required drivers, runtime, database, AI/ML libraries, container runtime, backup utilities, and integration software.

Required software stack shall include:

- Docker / Docker Compose or equivalent service management
- NVIDIA driver, CUDA, and NVIDIA Container Toolkit
- PostgreSQL with TimescaleDB or equivalent time-series data support
- Python-based AI/ML runtime
- YOLOv8s-Fire model runtime for smoke/fire detection
- XGBoost for forecasting and transformer temperature modelling
- Isolation Forest or equivalent anomaly detection model
- REST API, MQTT, OPC UA gateway, or equivalent interface for SCADA/Ampris integration
- Automated backup and log retention services

Windows Server shall be used only if required by the Ampris backend. If Windows is mandatory, the preferred architecture shall be Windows VM for Ampris backend only, while database and AI/ML services shall remain on Ubuntu Server.

## 2. CCTV Based Smoke and Fire Detection

The Firm shall provide CCTV based smoke/fire detection for substation critical areas. The system shall use IP CCTV cameras connected to NVR/NAS and AI analytics running fully on-premises.

The smoke/fire detection model shall be YOLOv8s-Fire or equivalent approved model. The model shall process local RTSP camera streams on the on-premises GPU server. Jetson Orin or cloud processing shall not be used.

### 2.1 CCTV and Storage Requirements

The system shall support up to 8 CCTV cameras for AI smoke/fire detection. CCTV storage shall be provided separately from the application/database storage.

| Component | Specification |
| --- | --- |
| Cameras | ONVIF/RTSP IP cameras, suitable for substation environment |
| AI Stream | 1080p sub-stream preferred, 5 to 10 FPS analytics per camera |
| NVR/NAS | Dedicated CCTV NVR/NAS |
| Storage | 6 x 12 TB or 8 x 12 TB HDD minimum in RAID 6 |
| Retention | 60 to 90 days, depending on camera bitrate and recording profile |
| Network | Managed PoE switch with CCTV VLAN |

### 2.2 Alarm Operation

On smoke/fire detection, the system shall trigger:

- SCADA alarm popup with camera name and location
- Local hooter/siren
- Visual beacon/strobe
- Alarm acknowledgement on SCADA HMI
- Timestamped event log
- NVR bookmark/event recording
- Snapshot and event clip reference
- Authorized LAN workstation notification where applicable

The system shall include configurable detection zones, masking, confidence threshold, alarm delay, and sensitivity settings to reduce false alarms.

Physical smoke/fire detectors shall also be provided in critical indoor/enclosed areas and connected to RTU/SCADA digital inputs through suitable potential-free contacts or isolation interfaces.

## 3. Day-Ahead Load Forecasting

The SCADA system shall include an on-premises load forecasting module. The module shall forecast feeder-wise and transformer-wise load for the next 24 hours using locally stored historical SCADA data.

Input data shall include, where available:

- Current, voltage, active power, reactive power, apparent power, power factor
- Energy and demand values
- Transformer and feeder loading
- Time-of-day, day-of-week, month, and seasonal pattern
- Outage/interruption history
- Alarm/trip history

Forecast output shall include:

- Next 24-hour feeder-wise load forecast
- Next 24-hour transformer-wise load forecast
- Peak load time prediction
- Overload threshold warning
- Forecast vs actual comparison
- Exportable reports in PDF, Excel, and CSV

The forecasting module shall be advisory and shall not automatically operate any breaker or protection system.

## 4. AI Based Transformer Oil Temperature Monitoring

The SCADA system shall include real-time transformer oil temperature monitoring and AI-based thermal anomaly detection.

Transformer oil temperature shall be measured using actual OTI/RTD/temperature transducer or existing transformer relay output connected to RTU/SCADA through analog input or approved communication protocol.

The AI analytics module shall compare transformer oil temperature, winding temperature where available, transformer loading, and historical thermal behavior to detect:

- Abnormal oil temperature rise
- Cooling inefficiency
- Overload-related heating
- Deviation from normal thermal trend
- Early transformer thermal risk condition

The SCADA dashboard shall display:

- Transformer-wise oil temperature
- Winding temperature where available
- Load current and loading percentage
- Warning and critical alarm status
- Historical temperature trend
- AI thermal anomaly/risk indication

AI thermal alerts shall be advisory only and shall not replace transformer protection relays, trip logic, statutory protections, electrical interlocks, or authorized operator confirmation.

## 5. Energy Loss and Fault-Risk Analytics

The system shall include on-premises analytics for energy loss and abnormal operating pattern detection.

Analytics shall include:

- Incoming energy vs outgoing feeder energy comparison
- Transformer and feeder loss calculation
- Abnormal feeder consumption detection
- Voltage/current imbalance detection
- Repeated alarm/trip pattern detection
- Advisory trip-risk or abnormal-condition indicator

The system shall use rule-based electrical thresholds and anomaly detection models. AI/ML outputs shall be advisory and shall not replace protection relay operation.

## 6. Network and Cybersecurity

The system shall use network segmentation with separate logical zones for:

- SCADA network
- CCTV network
- AI/application server network
- Office/LAN access network

Cybersecurity requirements:

- Firewall/security gateway between network zones
- Role-based access control
- User authentication and password protection
- Event logging for alarms, user actions, acknowledgements, and model alerts
- No internet dependency for normal operation
- No SCADA data, CCTV stream, AI input/output, alarms, logs, or reports shall leave OFBA premises
- Offline/manual AI model updates only with owner approval

## 7. Deliverables

The Firm shall provide:

- On-premises AI/application server with RAID storage and UPS integration
- Required operating system, drivers, AI runtime, database, and integration software
- PostgreSQL/TimescaleDB or equivalent database configuration
- YOLOv8s-Fire smoke/fire detection deployment
- Load forecasting module
- Transformer oil temperature AI analytics module
- Energy anomaly and fault-risk analytics module
- Dedicated CCTV NVR/NAS storage with RAID 6
- IP cameras, PoE switch, mounting, cabling, power, and accessories
- Physical smoke/fire detectors for critical locations
- Hooter/siren and visual beacon/strobe
- SCADA HMI integration for AI alarms and dashboards
- System architecture diagram
- Network and VLAN diagram
- Wiring and I/O diagrams
- AI model configuration and threshold document
- FAT/SAT reports
- User training and maintenance documentation

## 8. FAT and SAT Acceptance Tests

Acceptance testing shall include:

- Verify complete operation without internet connectivity
- Verify Ampris backend and database running on main on-premises server
- Verify RAID layout, disk health monitoring, and backup jobs
- Verify up to 8 CCTV RTSP streams are available to AI service
- Verify YOLOv8s-Fire smoke/fire detection triggers correct event metadata
- Verify SCADA alarm, hooter/siren, beacon, acknowledgement, and event log for smoke/fire
- Verify physical smoke/fire detector input triggers SCADA alarm and local annunciation
- Verify NVR continuous recording and alarm clip bookmarking
- Verify 24-hour load forecast generated locally from SCADA historical data
- Verify transformer oil temperature acquisition from OTI/RTD/transducer or relay output
- Verify transformer oil temperature warning and critical alarm thresholds
- Verify AI thermal anomaly alert is advisory and does not operate breaker/protection logic
- Verify energy loss/anomaly dashboard and reports
- Verify authorized LAN access only
- Verify SCADA core monitoring continues if AI service is stopped
- Verify report export to PDF, Excel, and CSV

## 9. Warranty and Support

The complete AI/application server, CCTV AI analytics, database configuration, NVR/NAS storage, AI/ML modules, dashboards, alarms, reports, and integration work shall be covered under the project warranty.

Warranty support shall include:

- Hardware replacement for supplied server/CCTV/NVR components
- Software bug rectification
- AI model configuration correction
- Database and backup service support
- SCADA integration support
- Cybersecurity configuration support
- Technical assistance during warranty period

## 10. Safety and Control Limitation

All AI/ML outputs shall be advisory in nature. AI shall not bypass, override, or replace electrical protection relays, safety interlocks, breaker trip logic, statutory protection schemes, or operator confirmation procedures.

Protection and control shall continue to be governed by approved electrical protection devices, SCADA control logic, safety interlocks, and authorized operator action.
