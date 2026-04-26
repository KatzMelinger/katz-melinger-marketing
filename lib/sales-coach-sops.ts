/**
 * Embedded Katz Melinger SOPs and scripts. Auto-generated from
 * scripts/sops_extract/ — DO NOT edit by hand. Regenerate with
 *   python scripts/generate_sop_constants.py
 *
 * These constants are injected into the AI scoring system prompt so
 * Claude grades calls against the firm's own standards. Values are
 * also mirrored into the public.sales_training_materials table when
 * the user uploads through /settings/sales-training; until then the
 * constants here are the source of truth.
 */
export type SopDocument = {
  fileName: string
  sectionCode: string
  docType: 'sop' | 'script' | 'playbook' | 'glossary'
  text: string
}

export const SOP_511_B_INTAKE_DEFINITIONS_GLOSSARY: SopDocument = {
  fileName: '5.1.1-b Intake definitions_glossary',
  sectionCode: '5.1.1-b',
  docType: 'glossary',
  text: `5.1.1-b — Intake Definitions & Glossary
Core Intake Terms
Intake Record – A record capturing information about a Potential Client and their legal matter prior to engagement.

Potential Client (PC) – An individual or entity seeking legal representation who is not yet a client of the Firm.

Intake Team – Administrative team responsible for Intake record creation, information gathering, scheduling, and client communications.

Sales / Case Evaluator – Role responsible for reviewing Intake records, conducting consultations, and determining whether a matter proceeds, is declined, or referred.

Attorney Review – Legal evaluation provided by an Attorney when escalation is required; advisory only.

Engagement – Formal agreement to represent a client, evidenced by a signed Engagement Letter and receipt of required fees.

Intake Statuses – Intake & Review
Partial Intake – Initial Intake incomplete; because could not complete the initial call or are awaiting additional information needed for initial evaluation. (Intake Team queue)

Initial Review – Initial Intake complete and ready for Sales / Case Evaluator review.

Awaiting Documents – Additional documents required from PC. (Intake Team queue)

Pending Admin Follow-Up – Additional administrative, documentation or informational follow-up required. (Intake Team queue)

Secondary Review – Requested documents received and ready for review for Sales/Case Evaluator to review.

Schedule a Call – Intake approved for consultation; Intake Team schedules call.

Consultation Scheduled – Consultation booked and confirmed.

Consultation Rescheduled – Consultation rescheduled.

Consultation No Show – PC failed to attend scheduled consultation.
Follow-Up Consultation – Additional consultation required.

Pending PC Decision – PC deciding whether to proceed.

Reviewer Check-In – Check-in required by Sales / Case Evaluator.

Reviewer Follow-Up – Follow-up required regarding consultation discussion.

Pending Firm Decision – Attorney input required before decision.
Decline & Referral Statuses
Decline – Not a Fit – Matter not within the Firm’s practice areas or jurisdiction and not referred to another attorney by the Firm.

Decline – For Now – Matter not actionable at this time; may be viable later.

Decline – Firm – Firm elects not to proceed.

Decline – Client No Show – PC unresponsive after no-show.

Decline – Client Reject – PC elects not to proceed.

Decline – Referred – Matter referred to another firm.

Decline – Notice Sent – Decline Notice sent; Intake closed.
Engagement & Matter Creation Statuses
Pending Engagement Letter – Firm intends to proceed; engagement to be created and sent to PC.

Engagement Letter Sent – Engagement Letter sent to PC.

Received Signed Engagement Letter – Executed Engagement Letter received.

Pending Retainer / Flat Fee – Engagement executed; payment pending.

Retainer / Flat Fee Received – Required payment received and validated.

Create New Matter – All pre-engagement requirements satisfied; ready for Matter creation.

Usage Note : This document is a reference resource only and must be used in conjunction with Intake, Sales / Case Evaluator, Attorney, and Decline Notice SOPs.`,
}

export const SOP_512_NEW_CLIENT_CALLS_INCOMING: SopDocument = {
  fileName: '5.1.2 New Client Calls (incoming)',
  sectionCode: '5.1.2',
  docType: 'sop',
  text: `1. Internal Policy
It is the policy of the Firm that all incoming new client calls are handled live, in real time, and completed fully during the call using the Firm’s intake systems. Intake information must not be deferred to email when a potential client initiates contact by phone. Email outreach for intake purposes is permitted only when the Firm has attempted and failed to reach the potential client after outbound call attempts.
2. Procedure
Inbound Call Handling  ( add deferred call details ) **
All incoming calls from potential clients must be answered live whenever possible.
When a potential client calls the Firm, the Intake Specialist must accurately complete and enter the information into the Firm database for the entire intake during the phone call.
Intake Specialists should not send an email requesting intake information when the potential client has called the Firm directly.
Add Deadline Flagging 5.1.16 **
Ownership Assignment
1.  The Intake Specialist who answers and completes the intake call becomes the 	  
     PC Owner.
2.  Ownership remains with that Intake Specialist until the PC is transferred to the         
      legal team or formally declined.
Documentation Requirements
1.   All intake questions must be completed live on the phone.
2.   Documents provided during the call must be uploaded immediately or requested
      verbally before the call ends.
3.   Next steps must be clearly communicated to the potential client before ending  
      the call.
Exception – Email Outreach
Email requests for intake information are permitted only when:
The potential client cannot be reached after reasonable call attempts.
Email may not be used as a substitute for live intake when the client calls in.
3. Resources
Resource #1: Jotform Intake Forms
Resource #2: Airtable Intake Database
Resource #3: Intake Coverage and Weekly Rotation Plan`,
}

export const SOP_512_A_INCOMING_INTAKE_SCRIPT: SopDocument = {
  fileName: '5.1.2-a Incoming Intake Script',
  sectionCode: '5.1.2-a',
  docType: 'script',
  text: `INCOMING INTAKE CALL
Call Script & Reference Guide  |  Katz Melinger
STEP 1 — OPEN THE CALL
Introduce Yourself
Confirm Availability
Ask: How may we assist you today?
If proceeding with intake, confirm availability:
📌 If they ask how long: say about 10 to 15 minutes.
If NO: "No problem! What would be a better time for you? I can schedule a follow-up call at your convenience."
📌 Schedule and send a calendar invite.
Ensure Confidentiality
STEP 2 — SET THE AGENDA
Propose an agenda based on the type of matter:
Employment Matter
Severance Matter
Collections Matter
Address Immediate Concerns
Ask: "Do you have any specific concerns or questions about this process before we begin?"
STEP 3 — GATHER INFORMATION
Personal Details
Gather initial information on Jotform.
Key Issue Identification
Ask: "Can you summarize the main issue you're facing with your employer?"
Desired Outcome
Ask: "What are you hoping to achieve by working with our firm?"
📌 Examples: compensation, reinstatement, etc.
Wrap Up Information Gathering
Ask: "Is there any other information you want to provide that we have not yet covered?"
STEP 4 — CLOSE THE CALL
Provide Next Steps
If asked what next steps are: "Our team will determine if we can assist you on your matter, or need further information, or whether there are other resources we can provide to help you."
Address Final Questions
Ask: "Do you have any questions for me before we finish this call?"
STEP 5 — SUBMIT THE INTAKE
Before submitting, select a case quality rating:
High
Medium
Low
Then submit the intake for review.
COMPLIANCE & BEST PRACTICES
Confidentiality: Ensure all client information is securely recorded and protected.
Professionalism: Maintain a courteous and empathetic approach at all times.
Accuracy: Verify all client details before finalizing the intake.
"Thank you for calling Katz Melinger, my name is [Your Name], may I ask who is calling?"
"I would just like to confirm that now is a good time to speak to gather the information needed to evaluate your claim. This will take a few minutes of your time."
"Before we continue, I want to assure you that everything we discuss today is completely confidential. Only the Katz Melinger team will have access to your information. We will review your information but will not reach out to anyone or discuss this matter outside the firm without your permission. Does that sound good to you?"
"I'll start by asking you a few questions to gather some basic information. Then, we'll go over details regarding your employer and pay. Once that's covered, we can get into the specifics of the issue for your call."
"I'll start by asking you a few questions to gather some basic information. Then, we'll go over details regarding your employer and your severance details. Once that's covered, we can discuss any other concerns you have with your employment."
"I'll start by asking you a few questions to gather some basic information. Then, we'll go over details regarding the debt you are owed and what you have done so far. Once that's covered, we can get into any other concerns you may have."
"Thank you for sharing this information. Our legal team will now review your potential matter to see if we can help you. Next, you'll receive a response from our team to discuss the next steps."`,
}

export const SOP_512_B_OUTGOING_INTAKE_SCRIPT: SopDocument = {
  fileName: '5.1.2-b Outgoing Intake Script',
  sectionCode: '5.1.2-b',
  docType: 'script',
  text: `OUTGOING INTAKE CALL
Call Script & Reference Guide  |  Katz Melinger
STEP 1 — OPEN THE CALL
Introduce Yourself
📌 If they do not recognize Katz Melinger, remind them that we are a law firm they reached out to or spoke to recently about their potential matter.
Confirm Availability
📌 If they ask how long: say about 5 to 10 minutes.
If NO: "No problem! What would be a better time for you? I can schedule a follow-up call at your convenience."
📌 Schedule and send a calendar invite.
📌 If they confirm availability, move directly to Step 2.
Ensure Confidentiality
STEP 2 — SET THE AGENDA
Select the agenda based on the reason for the outgoing call:
Reason: Further Questions Needed
Reason: Documents Needed
Reason: Other
📌 If the call involves a mix of categories, adjust the agenda language to reflect that.
Address Immediate Concerns
Ask: "Do you have any specific concerns or questions about this process before we begin?"
STEP 3 — GATHER INFORMATION
Collect the information needed based on the reason for the call. Reference the notes from the original intake or prior communications before dialing.
Wrap Up Information Gathering
Ask: "Is there any other information you want to provide that we have not yet covered?"
STEP 4 — CLOSE THE CALL
Provide Next Steps
If asked what next steps are: "Our team will determine if we can assist you on your matter, or need further information, or whether there are other resources we can provide to help you."
Address Final Questions
Ask: "Do you have any questions for me before we finish this call?"
STEP 5 — SUBMIT THE INTAKE
Before submitting, select a case quality rating:
High
Medium
Low
Then submit the intake for review.
COMPLIANCE & BEST PRACTICES
Confidentiality: Ensure all client information is securely recorded and protected.
Professionalism: Maintain a courteous and empathetic approach at all times.
Accuracy: Verify all client details before finalizing the intake.
"Hi, my name is [Your Name], and I'm calling from Katz Melinger. Am I speaking with Mr./Ms. [Person's Last Name]?"
"I would just like to confirm that now is a good time to speak for a few minutes so we can discuss your matter further."
"Before we continue, I want to assure you that everything we discuss today is completely confidential. Only the Katz Melinger team will have access to your information. We will review your information but will not reach out to anyone or discuss this matter outside the firm without your permission. Does that sound good to you?"
"To make the best use of our time today, I'll start by asking you a few questions to gather some additional information that the legal team needs to assess your potential matter. Once that's covered, we can get into any other questions you might have on the process. Does that sound good?"
"To make the best use of our time today, I'll start by asking you a few questions about documents you might have that could assist the legal team in assessing your potential matter. Once that's covered, we can get into any other questions you might have on the process. Does that sound good?"
"To make the best use of our time today, I'll start by asking you a few questions about [describe reason for calling] which could assist the legal team in assessing your potential matter. Once that's covered, we can get into any other questions you might have on the process. Does that sound good?"
"Thank you for sharing this information. Our legal team will now review your potential matter to see if we can help you. Next, you'll receive a response from our team to discuss the next steps."`,
}

export const SOP_522_SALES_CASE_EVALUATOR_REVIEW_PROCESS: SopDocument = {
  fileName: '5.2.2 Sales_Case Evaluator Review Process',
  sectionCode: '5.2.2',
  docType: 'sop',
  text: `1. Internal Policy
It is the policy of the Firm that all Intake records assigned for evaluation are reviewed and managed by the Sales / Case Evaluator using a standardized, status-driven workflow to ensure consistent evaluation, timely communication with Potential Clients (PCs), proper coordination with the Intake Team and Attorneys (if applicable), and accurate progression toward decline, referral, or engagement.
This SOP governs the responsibilities of the Sales / Case Evaluator from the point an Intake record enters the review queue through consultation handling, case disposition, and engagement advancement. Intake creation, administrative follow-up, and scheduling execution are governed by the Intake SOP. Attorney legal review and final legal determinations are governed by separate Attorney SOPs.
All Sales / Case Evaluators are required to follow this SOP to ensure consistency, operational clarity, and compliance.
2. Procedure
2.1 Receipt of Intake for Review
Intake records are assigned to the Sales / Case Evaluator when the Intake Team places the record into Initial Review.
Upon receipt, Sales / Case Evaluator shall review the Intake record to determine whether additional documents or information or attorney review is required, and whether a consultation, referral or declination is appropriate.
2.2 Requesting Additional Documents or Administrative Follow-Up
If additional documents are required before moving forward, assign the Case Status Pending Admin Follow-Up.
This moves the Intake record into the Intake Team’s work queue.
Once the Intake Team has contacted the PC and formally requested the required documents, assign the Case Status Awaiting Documents.
This confirms the Firm is waiting on the PC to provide the requested materials.
Do not proceed with “schedule a call” until requested items are received.
2.3 Reviewing Returned Intake Records
When requested documents are received, the Intake Team will assign the Case Status Documents to Review, confirming the Intake records moves back into the Sales/ Case Evaluator work queue.
When requested documents and/ or information is received, the Intake Team will move to Secondary Review status.
This moves the record back to the Sales Case Evaluator work queue.
Upon receipt, re-evaluate the Intake record and determine the appropriate next steps.
2.4 Consultation Readiness and Scheduling
If the Intake record is ready for a consultation with the PC, assign the Case Status Schedule a Call.
Assigning Schedule a Call transfers responsibility to the Intake Team to schedule the consultation.
Once the consultation is scheduled, the Intake Team will update the Case Status to Consultation Scheduled, returning the Intake record to the Sales / Case Evaluator’s work queue.
If the consultation is rescheduled, update the Case Status to Consultation Rescheduled.
If the PC fails to attend the consultation, update the Case Status to Consultation No Show.
If the PC becomes unresponsive and does not reschedule after reasonable follow-up, update the Case Status to Decline – Client No Show.
2.5 Post-Consultation Follow-Up
If an additional consultation is required, assign the Case Status Follow-Up Consultation.
If the PC is deciding whether to proceed, assign the Case Status Pending PC Decision.
If a check-in with the PC is required, assign the Case Status Reviewer Check-In.
If follow-up regarding items discussed during the consultation is required, assign the Case Status Reviewer Follow-Up.
All follow ups are required within 48 hours of status change.
2.6 Firm Decision and Attorney Involvement
Once sufficient information has been gathered, determine whether the Intake record should be declined, referred, or advanced toward engagement.
If attorney input is required prior to making a decision, assign the Case Status Pending Firm Decision.
This moves the Intake record into the Attorneys’ work queue.
Sales/ Case Evaluator owns this phase and is their responsibility to follow up with the Attorney. (Every 24 hours)
2.7 Decline and Referral Outcomes
If the case is declined based on Firm fit or timing, the Sales / Case Evaluator must assign one of the following decline Case Statuses:
Decline – Not a Fit
Decline – For Now
Decline – Firm
Assigning Decline – Not a Fit, Decline – For Now, or Decline – Firm signals the Intake Team to complete the Decline Notice process in accordance with the Firm’s Decline Notice SOP.
If the case is to be referred to another firm, the Sales / Case Evaluator must assign Decline – Referred.
Assigning Decline – Referred moves the Intake record into the Intake Team’s work queue for referral processing.
Once the Decline Notice has been sent by the Intake Team and the Intake record is moved into Decline – Notice Sent, the Intake is closed and removed from the Intake work queue.
The following decline-related Case Statuses are owned and managed exclusively by the Sales / Case Evaluator and remain in the Sales / Case Evaluator’s work queue. These statuses do not trigger Intake Team action unless otherwise directed by a separate SOP:
Decline – Client Reject
Decline – Client No Show
Decline – No Response to Engagement Letter
2.8 Engagement Advancement and Automated Progression
If the Firm elects to proceed with the case, assign the Case Status Pending Engagement Letter.
Once the Engagement Letter is sent to the PC, the Intake record will be updated to Engagement Letter Sent.
Upon execution of the Engagement Letter by the PC, system automation will send an email to the Sales/ Case Evaluator that we received the signed Engagement Letter.
Sales/ Case Evaluator to confirm payment if flat fee/ retainer is required.
If a retainer or flat fee is required, the Intake record will move it to Pending Retainer / Flat Fee.
Upon confirmation that the required payment amount has been received and validated through the Firm’s payment system, the Intake record will be updated to Retainer / Flat Fee Received.
Once engagement and payment requirements are satisfied, the Intake record will advance to Create New Matter, triggering operational handoff.
After the Matter is created, the Intake record will be removed from the Intake work queue.
3. Resources
Resource #1: 5.1.1-b Intake definitions / glossary
Resource #2: Intake SOP add link
Resource #3: 5.2.3  Attorney Review Process`,
}

export const SOP_523_A_SALES_TEAM_PLAYBOOK: SopDocument = {
  fileName: '5.2.3-a Sales Team Playbook',
  sectionCode: '5.2.3-a',
  docType: 'playbook',
  text: `KATZ MELINGER PLLC
Sales Team Playbook
Consultation Call Scripts & Fee Guides
Resource Guide  |  5.2.3-a
For Internal Use Only — Sales / Case Evaluator Team
How to Use This Guide
This playbook is designed to support you through every consultation call — from the moment you pick up the phone to the moment you close the engagement.
Here is how it works:
Start with the Universal Opening Script at the top of this guide. Use it on every call, regardless of case type.
Once you know what kind of matter the client is calling about, jump to the appropriate section using the Table of Contents below.
Each section includes a conversation script, fee presentation, objection handling, and escalation guidance.
Table of Contents
↑ Back to Table of Contents
PART 1 — Universal Opening Script
Use this opening on every consultation call — before you know anything about the case type. Do not skip this section.
Opening the Call
Use the appropriate opening based on whether you took this PC's original intake call or not.
If this is YOUR PC — you took the original intake call:
"Hi [Name], this is [Your Name] calling from Katz Melinger — we actually spoke when you first reached out to us. I'm following up because our team has had a chance to review your information, and I'm happy to tell you we'd love to help you. I'd like to take a few minutes to go over what we can do for you and walk you through how we work — does now still work for you?"
If this is NOT your PC — you are covering for a colleague:
"Hi [Name], this is [Your Name] calling from Katz Melinger. Our team has had a chance to review your information, and I'm happy to tell you we'd love to help you. I'd like to take a few minutes to go over what we can do for you and walk you through how we work — does now still work for you?"
If the PC seems surprised or asks what this is about:
"Of course — you reached out to our firm regarding [matter type]. Our team reviewed your information and we'd like to move forward. I just want to walk you through our fees and next steps — it should only take a few minutes."
If the Client Has Already Vented or Is Upset
Step 1 — Express Empathy
"I appreciate you taking the time to speak with us today. I want you to know that we have helped many people in situations similar to yours, and we are confident we can help you too."
Step 2 — Restate the Issue
Briefly acknowledge what brought them to us — this shows you reviewed their file and builds confidence that the right people are handling their matter.
Step 3 — Start Moving Forward
Your goal on this call is to present the fees, handle any objections, and sign up the PC. You are moving them from this call to sending out the Engagement Letter and payment link.
Step 4 — Confirm Next Steps
Once they agree to move forward:
"You will be receiving an email with your Engagement Letter — please review and sign it at your earliest convenience. Once that is signed and your payment is processed, your case will be introduced to your legal team."
Match the Client's Energy
Communication Best Practices
Goal: Disarm the client and show that you are taking ownership of the issue.
PART 2 — Identifying the Case Type
Once you have completed the opening and gathered basic information, identify which type of matter the client is calling about. Then navigate to the correct fee guide section using the table below.
Quick Reference — Which Fee Guide Do I Use?
↑ Back to Table of Contents
PART 3 — Collections & Judgment Enforcement
3.1  Pre-Litigation / Demand Letters  (5.2.6-b)
Use when: Client needs a demand letter sent to collect money owed. No lawsuit has been filed yet.
Conversation Script
STEP 1 — Ask About the Claim Amount
"What is the total amount you're trying to collect?"
→ Write down the amount. This determines which tier applies.
STEP 2 — Determine Which Tier Applies
Under $50,000 → Tier 1
$50,001 – $250,000 → Tier 2
Over $250,000 → Tier 3
STEP 3 — Present ONLY the Fee Structure That Applies
Do NOT list all three tiers. Only present the one that applies to this client.
For claims UNDER $50,000:
"Here's how our fees work: You'll pay a $1,500 flat fee to get started. Then we earn 1/3 of the first $500,000 we recover for you, 25% of the next $500,000, and 30% of anything beyond that. This way, we only make more money when you do."
For claims $50,001 – $250,000:
"Here's how our fees work: You'll pay a $2,500 flat fee to get started. Then we earn 1/3 of the first $500,000 recovered, 25% of the next $500,000, and 30% of anything beyond that."
For claims OVER $250,000:
"Here's how our fees work: You'll pay a $5,000 flat fee to get started. Then we earn 1/3 of the first $500,000 recovered, 25% of the next $500,000, and 30% of anything beyond that."
Fee Breakdown — Pre-Litigation
Objection Handling
Escalation: If client needs a fee adjustment → Ping Adam Sackowitz or Kenneth Katz.
↑ Back to Table of Contents
3.2  Judgment Enforcement  (5.2.6-c)
Use when: A judgment already exists and the client needs help collecting the money owed.
Conversation Script
STEP 1 — Ask About the Judgment Amount
"What is the total judgment amount?"
→ Write down the amount.
STEP 2 — Ask About Court Filing
"Will we need to file anything in court, or is this just enforcement?"
→ Note whether court filing is needed — this affects the contingency percentage.
STEP 3 — Determine Which Tier Applies
Under $50,000 → Tier 1
$50,001 – $250,000 → Tier 2
Over $250,000 → Tier 3
STEP 4 — Present ONLY the Fee Structure That Applies
Do NOT list all three tiers. Only present the one that applies to this client.
For judgments UNDER $50,000:
"Here's how our fees work: You'll pay a $1,500 flat fee to get started. Then we earn 1/3 of the first $500,000 we collect, 25% of the next $500,000, and 30% of anything beyond that."
For judgments $50,001 – $250,000:
"Here's how our fees work: You'll pay a $2,500 flat fee to get started. Then we earn 1/3 of the first $500,000 collected, 25% of the next $500,000, and 30% of anything beyond that."
For judgments OVER $250,000:
"Here's how our fees work: You'll pay a $5,000 flat fee to get started. Then we earn 1/3 of the first $500,000 collected, 25% of the next $500,000, and 30% of anything beyond that."
If Court Filing Is Required:
"If we need to file anything in court during enforcement, our contingency percentage increases slightly. It becomes 40% of the first $250,000, 1/3 of the next $750,000, and 35% beyond that."
Fee Breakdown — Judgment Enforcement
Objection Handling
↑ Back to Table of Contents
3.3  Collections Litigation  (5.2.6-d)
Use when: Client needs to file a lawsuit to collect money owed. This involves full litigation.
Conversation Script
STEP 1 — Ask About the Claim Amount
"What is the total amount you're trying to collect?"
→ Write down the amount.
STEP 2 — Determine Which Tier Applies
Under $250,000 → Tier 1
$250,001 – $1,000,000 → Tier 2
Over $1,000,000 → Tier 3
STEP 3 — Present ONLY the Fee Structure That Applies
For claims UNDER $250,000:
"For litigation, the flat fee is $5,000 to get started. Then we earn 40% of the first $250,000 we recover, 1/3 of the next $750,000, and 35% of anything beyond that."
For claims $250,001 – $1,000,000:
"For litigation, the flat fee is $7,500 to get started. Then we earn 40% of the first $250,000 recovered, 1/3 of the next $750,000, and 35% of anything beyond that."
For claims OVER $1,000,000:
"For litigation, the flat fee is $10,000 to get started. Then we earn 40% of the first $250,000 recovered, 1/3 of the next $750,000, and 35% of anything beyond that."
Fee Breakdown — Collections Litigation
Objection Handling
↑ Back to Table of Contents
3.4  Domestication of Foreign Judgments  (5.2.6-e)
Use when: An out-of-state judgment needs to be enforced in New York or New Jersey.
Conversation Script
STEP 1 — Ask Key Questions
"Where was the original judgment entered?"
"Was this a default judgment, confession of judgment, or did the defendant appear in court?"
"Are you also looking for enforcement help, or just domestication?"
STEP 2 — Determine Which Scenario Applies
SCENARIO A — New Jersey (any case) OR New York where defendant appeared in court:
"For domestication, the flat fee is $1,500 plus a $250 retainer for expenses. If you also need enforcement help, we add a contingency fee: 1/3 of the first $500,000 collected, 25% of the next $500,000, and 30% beyond that."
"If we need to file in court during enforcement, the contingency increases to: 40% of the first $250,000, 1/3 of the next $750,000, and 35% beyond that."
SCENARIO B — New York where defendant did NOT appear (default or confession of judgment):
"For this type of case, domestication is more complex. The flat fee is $5,000 plus a $500 retainer. If you also need an order of attachment, that's an additional $5,000. For enforcement, the same contingency applies: 1/3 of the first $500,000, 25% of the next $500,000, and 30% beyond."
Fee Breakdown — Domestication
Scenario A: NJ (Any Case) or NY (Defendant Appeared)
Scenario B: NY Default / Confession of Judgment
Objection Handling
Escalation: If unsure about case type or fee structure → Contact Adam Sackowitz or Kenneth Katz.
↑ Back to Table of Contents
PART 4 — Employment Matters
4.1  Severance  (5.2.6-f)
Use when: Client is negotiating a severance package with their employer.
Conversation Script
STEP 1 — Ask About the Current Offer
"What severance package is your employer currently offering?"
→ Note the details — money, benefits, length of time, etc.
STEP 2 — Present the Fee Structure
"Here's how our fees work for severance negotiation: You'll pay a flat fee of $1,500 to get started. Then, we earn 1/3 of any increase in money or benefits we negotiate above what they're currently offering. So if they're offering you $10,000 and we get that up to $20,000, we earn 1/3 of that $10,000 increase."
Fee Breakdown — Severance
Objection Handling
Escalation: If client needs a fee adjustment → Ping Nicole Grunfeld or Kenneth Katz for approval.
Note: Flat fee may be negotiable in strong cases with prior approval.
↑ Back to Table of Contents
4.2  Wage and Hour  (5.2.6-g)
Use when: Unpaid wages, overtime violations, minimum wage claims, or similar wage and hour issues.
Conversation Script
STEP 1 — Determine Demand Letter or Litigation
"Do you want us to send a demand letter first, or are we filing a lawsuit?"
→ Demand letter = start here. Litigation = court filing will be required.
STEP 2 — Ask How Many People Are Involved
"Is this just for you, or are there other employees with the same issue?"
→ The flat fee is $1,500 per person.
STEP 3 — Present the Fee Structure
For a Demand Letter:
"The flat fee is $1,500 per person to send the demand letter. Then we earn 1/3 of whatever we recover for you."
For Litigation:
"The flat fee is $1,500 per person to file the lawsuit. Then we earn 40% of whatever we recover for you."
Fee Breakdown — Wage and Hour
Objection Handling
Escalation: Multiple clients with strong cases → Contact Nicole Grunfeld or Kenneth Katz about reducing or waiving the flat fee.
↑ Back to Table of Contents
4.3  Discrimination / Harassment / Retaliation  (5.2.6-h)
Use when: Client has a discrimination, harassment, or retaliation claim.
Conversation Script
STEP 1 — Ask How Many People Are Involved
"Is this just for you, or are there other employees?"
→ The flat fee is per person.
STEP 2 — Present Both Approaches
"Here's how our fees work for discrimination cases. There are two approaches we can take:"
Option 1 — Demand Letter:
"We start by sending a demand letter to try to resolve this without going to court. The flat fee is $2,500 per person, and we earn 1/3 of whatever we recover for you. This is often the faster, less expensive route."
Option 2 — Litigation:
"If we need to file a lawsuit, the flat fee is $5,000 per person, and we earn 40% of whatever we recover until depositions begin, then 45% after that."
"Your attorney will review your case during the consultation and recommend which approach makes the most sense. Once that's determined, we'll send you an Engagement Letter with the specific terms."
Fee Breakdown — Discrimination
Objection Handling
Escalation: Multiple clients with strong cases → Ping Nicole Grunfeld or Kenneth Katz about reducing or waiving the flat fee.
↑ Back to Table of Contents
PART 5 — Hourly / Counseling / Document Review
5.1  Hourly Fee Structure  (5.2.6-i)
Use when: Advisory matters, document review, or counseling. This structure is rarely used — most matters are handled on contingency or flat fee.
Conversation Script
STEP 1 — Explain Hourly Billing
"For this type of matter, we bill by the hour based on which attorney or staff member works on your case. Our rates range from $150 to $675 per hour depending on the person assigned. We'll provide you with a detailed invoice showing who worked on what."
STEP 2 — Discuss Which Attorney
"Based on your matter, [Attorney Name] would be the best fit. Their hourly rate is $[rate]."
Hourly Rate Breakdown
Objection Handling
Escalation: Always escalate hourly matters to the assigned attorney for final rate and scope 
discussion.
↑ Back to Table of Contents
PART 6 — Closing the Call
CLOSING:
Use this closing on every call after the fee discussion.
Closing the Call
" Based on everything we discussed today, we are excited to move forward with your case. You will be receiving an email with your Engagement Letter along with a link to complete your payment. Please review, sign, and submit your payment at your earliest convenience — once that is done, your case will be introduced to your legal team."
If the PC Pushes Back or Has Concerns
" I completely understand. What is your main concern right now?"
→ Listen, identify the objection, and handle it using the techniques in the relevant fee guide section. Then circle back to the close.
If the PC Has Questions About Legal Strategy
" That's a great question — your attorney will walk you through the full strategy once your engagement is confirmed. Would you like me to make a note of that so it gets addressed right away?”
→ Listen carefully. If this is a case you want to keep, handle the objection using the techniques in each fee guide section, then attempt to close again.
If Client Has Questions About Legal Strategy
"I'm not completely certain about the specific legal strategy. When you meet with your attorney in the next few days, they'll lay out the approach and answer all your questions in detail. Would you like me to make a note of your concerns so they can be addressed?"
Your Goal on Every Call
↑ Back to Table of Contents
💡 Tip: You do not need to read this entire guide on every call. The opening is universal — everything else is designed for quick reference mid-call.
Client's Emotional State | Your Response
Natural / Calm | Natural and steady
Angry | Show genuine concern
Panicked | Create a sense of urgency — reassure them you are on it
Friendly | Match with warmth and energy
Overburdened | Sympathetic — acknowledge how much they are carrying
Frustrated | Empathetic — validate without agreeing with misinformation
❌  Words to AVOID | ✅  Words to USE
You should… | Let's work on this…
You're wrong… (even if they are!) | I understand… let's…
I demand… | Can you help me understand…
We can't… | What I can do is…
We won't… | Help me better understand the issue
Not our policy… | This is a top priority for me…
You don't understand… | We should have…
That does not make any sense… | I'll make sure we make this right…
You must be confused… | 
I'm too busy to deal with this… | 
You have to… | 
Case Type | Section | Use When…
Pre-Litigation / Demand Letters | Section 3.1 | Client needs a demand letter sent — no lawsuit filed yet
Judgment Enforcement | Section 3.2 | A judgment already exists and client needs help collecting
Collections Litigation | Section 3.3 | Client needs to file a lawsuit to collect money owed
Domestication of Foreign Judgments | Section 3.4 | Out-of-state judgment needs to be enforced in NY or NJ
Severance | Section 4.1 | Client is negotiating a severance package
Wage and Hour | Section 4.2 | Unpaid wages, overtime, or minimum wage violations
Discrimination / Harassment / Retaliation | Section 4.3 | Discrimination, harassment, or retaliation claims
Hourly / Counseling / Document Review | Section 5.1 | Advisory matters — rarely used
Claim Amount | Flat Fee | Contingency Fee
Under $50,000 | $1,500 | 1/3 of first $500K 25% of next $500K 30% beyond
$50,001 – $250,000 | $2,500 | 1/3 of first $500K 25% of next $500K 30% beyond
Over $250,000 | $5,000 | 1/3 of first $500K 25% of next $500K 30% beyond
OBJECTION: "That flat fee seems high" | OBJECTION: "That flat fee seems high"
1st Attempt | "I understand. The flat fee ensures we can dedicate the resources needed for your case. Keep in mind, we only earn more when you do — our contingency fee means we're incentivized to get you the best result. Would you like to move forward?"
2nd Attempt | "I hear you. Many of our clients initially have the same concern, but they find that the flat fee is often recovered through the settlement or recovery we achieve. The alternative would be a higher contingency percentage, which could cost you more in the long run. Shall we move forward with the standard structure?"
Last Resort | "Let me reach out to our managing attorney to see if we have any flexibility on your specific case. I'll get back to you today with options. Can I follow up with you this afternoon?" → After the call: Ping Adam or Kenneth for approval.
OBJECTION: "What if you don't recover anything?" | OBJECTION: "What if you don't recover anything?"
Response | "You only owe the flat fee. If we don't recover anything for you, you won't owe us any additional fees beyond that initial amount."
⚠️  Alternative Fee Structure (No Flat Fee / Contingency Only): 40% of first $500K, 30% of next $500K, 35% beyond. ONLY offer after standard objection handling. Requires Adam Sackowitz or Kenneth Katz approval before presenting to the client.
Judgment Amount | Flat Fee | Contingency (No Court Filing) | Contingency (With Court Filing)
Under $50,000 | $1,500 | 1/3 of first $500K 25% of next $500K 30% beyond | 40% of first $250K 1/3 of next $750K 35% beyond
$50,001 – $250,000 | $2,500 | 1/3 of first $500K 25% of next $500K 30% beyond | 40% of first $250K 1/3 of next $750K 35% beyond
Over $250,000 | $5,000 | 1/3 of first $500K 25% of next $500K 30% beyond | 40% of first $250K 1/3 of next $750K 35% beyond
OBJECTION: "That flat fee seems high" | OBJECTION: "That flat fee seems high"
1st Attempt | "I understand. The flat fee ensures we can dedicate the resources needed for your case. We only earn more when you do — our contingency fee means we're incentivized to get you the best result. Would you like to move forward?"
2nd Attempt | "I hear you. Many clients initially have the same concern, but they find the flat fee is often recovered through the settlement or recovery we achieve. The alternative is a higher contingency percentage, which could cost more in the long run. Shall we move forward?"
Last Resort | "Let me reach out to our managing attorney to see if we have any flexibility. I'll get back to you today with options. Can I follow up with you this afternoon?" → After the call: Ping Adam or Kenneth for approval.
OBJECTION: "I already have a judgment — why do I need to pay more?" | OBJECTION: "I already have a judgment — why do I need to pay more?"
Response | "A judgment is just a piece of paper. The hard part is actually collecting the money. We handle all the enforcement work — bank levies, wage garnishments, property liens — to turn that judgment into cash."
⚠️  Alternative Fee Structure (Requires Adam / Kenneth approval): No Court Filing: 40% of first $500K, 30% of next $500K, 35% beyond. With Court Filing: 50% of first $250K, 45% of next $750K, 50% beyond. ONLY offer after standard objection handling.
Claim Amount | Flat Fee | Contingency Fee
Under $250,000 | $5,000 | 40% of first $250K 1/3 of next $750K 35% beyond
$250,001 – $1,000,000 | $7,500 | 40% of first $250K 1/3 of next $750K 35% beyond
Over $1,000,000 | $10,000 | 40% of first $250K 1/3 of next $750K 35% beyond
OBJECTION: "That flat fee seems high" | OBJECTION: "That flat fee seems high"
1st Attempt | "I understand. The flat fee ensures we can dedicate the resources needed for your case. We only earn more when you do. Would you like to move forward?"
2nd Attempt | "I hear you. Many clients find the flat fee is recovered through the settlement we achieve. The alternative is a higher contingency percentage, which could cost more. Shall we move forward with the standard structure?"
Last Resort | "Let me reach out to our managing attorney to see if we have any flexibility. I'll get back to you today. Can I follow up this afternoon?" → After the call: Ping Adam or Kenneth for approval.
OBJECTION: "Why is the flat fee higher for litigation?" | OBJECTION: "Why is the flat fee higher for litigation?"
Response | "Litigation involves filing a lawsuit, court appearances, discovery, and potentially trial. It's significantly more work than sending demand letters, so the upfront cost reflects that."
⚠️  Alternative Fee Structure (No Flat Fee / Contingency Only): 50% of first $250K, 45% of next $750K, 50% beyond. ONLY offer after standard objection handling. Requires Adam Sackowitz or Kenneth Katz approval.
Service | Flat Fee + Retainer | Contingency (if enforcement)
Domestication Only | $1,500 + $250 retainer | N/A
Domestication + Enforcement (No court filing) | $1,500 + $250 retainer | 1/3 of first $500K 25% of next $500K 30% beyond
Domestication + Enforcement (With court filing) | $1,500 + $250 retainer | 40% of first $250K 1/3 of next $750K 35% beyond
Service | Flat Fee + Retainer | Contingency (if enforcement)
Domestication Only | $5,000 + $500 retainer | N/A
Add Order of Attachment | + $5,000 additional | N/A
Domestication + Enforcement (No court filing) | $5,000 + $500 retainer | 1/3 of first $500K 25% of next $500K 30% beyond
Domestication + Enforcement (With court filing) | $5,000 + $500 retainer | 40% of first $250K 1/3 of next $750K 35% beyond
OBJECTION: "Why is the New York default case more expensive?" | OBJECTION: "Why is the New York default case more expensive?"
Response | "When the defendant didn't appear in the original case, New York law requires additional steps and filings. It's a more complex process, which is why the fee is higher."
OBJECTION: "Do I need enforcement, or just domestication?" | OBJECTION: "Do I need enforcement, or just domestication?"
Response | "Domestication makes the judgment valid in NY or NJ. Enforcement is actually collecting the money — bank levies, garnishments, etc. Most clients need both. We can start with domestication and add enforcement if needed."
Fee Type | Amount
Flat Fee | $1,500
Contingency Fee | 33.33% (1/3) of any increase in money and/or benefits above the current offer
📊  Example: Current offer $10,000 → Negotiated to $20,000 → Increase = $10,000 → Our fee = 1/3 of $10,000 = $3,333
OBJECTION: "That flat fee seems high" | OBJECTION: "That flat fee seems high"
1st Attempt | "I understand. The flat fee ensures we can dedicate the resources needed for your case. We only earn more when you do — our contingency means we're incentivized to get you the best result. Would you like to move forward?"
2nd Attempt | "I hear you. Many clients find the flat fee is recovered through what we negotiate. The alternative is a higher contingency percentage, which could cost more long-term. Shall we move forward?"
Last Resort | "Let me reach out to our managing attorney to see if we have any flexibility. I'll get back to you today. Can I follow up this afternoon?" → After the call: Ping Nicole or Kenneth for approval.
OBJECTION: "What if you can't improve the offer?" | OBJECTION: "What if you can't improve the offer?"
Response | "You only owe the $1,500 flat fee. If we don't increase your package at all, you won't owe any contingency fee."
⚠️  Do NOT discuss fee increases for appeals or counterclaims. Those details are in the engagement letter — you do not need to bring them up on this call.
Case Type | Flat Fee (Per Person) | Contingency Fee
Demand Letter | $1,500 per person | 33.33% (1/3) of gross recovery
Litigation | $1,500 per person | 40% of gross recovery
OBJECTION: "The flat fee is too high for our group" | OBJECTION: "The flat fee is too high for our group"
Response | "If you have multiple employees with strong cases, I can discuss with Nicole or Kenneth whether we can reduce or waive the flat fee. Let me get approval for that."
OBJECTION: "Why is litigation 40% instead of 1/3?" | OBJECTION: "Why is litigation 40% instead of 1/3?"
Response | "Litigation requires filing in court, discovery, depositions, and potentially trial. It's significantly more work than sending a demand letter."
⚠️  Do NOT discuss fee increases for appeals, counterclaims, or judgment enforcement. Those details are in the engagement letter — you do not need to bring them up on this call.
Approach | Flat Fee (Per Person) | Contingency Fee
Demand Letter | $2,500 per person | 33.33% (1/3) of gross recovery
Litigation (before depositions begin) | $5,000 per person | 40% of gross recovery
Litigation (after depositions begin) | $5,000 per person | 45% of gross recovery
📌  If client starts with demand letter ($2,500) and later needs litigation, they pay an additional $2,500 for a total flat fee of $5,000.
OBJECTION: "That flat fee seems high" | OBJECTION: "That flat fee seems high"
1st Attempt | "I understand. The flat fee ensures we can dedicate the resources needed for your case. We only earn more when you do. Would you like to move forward?"
2nd Attempt | "I hear you. Many clients find the flat fee is recovered through what we achieve. The alternative is a higher contingency percentage, which could cost more long-term. Shall we move forward?"
Last Resort | "Let me reach out to our managing attorney to see if we have any flexibility. I'll get back to you today. Can I follow up this afternoon?" → After the call: Ping Nicole or Kenneth for approval.
OBJECTION: "Why is litigation 40% instead of 1/3?" | OBJECTION: "Why is litigation 40% instead of 1/3?"
Response | "Litigation requires filing in court, discovery, depositions, and potentially trial. It's significantly more work than sending a demand letter."
Role | Rate Range | Individual Rates
Partners | $575 – $750/hr | Kenneth Katz: $675 Nicole Grunfeld: $625 Adam Sackowitz: $575
Associates | $400 – $550/hr | Other Associates (pending): $425
Paralegals | $250 – $350/hr | Isalice Acevedo: $275
Legal Assistants | $150 – $225/hr | Diomicsa Hernandez: $225 Maria Camacaro: $150 Ruqaiyah Khan: $150
OBJECTION: "How much will this cost total?" | OBJECTION: "How much will this cost total?"
Response | "It depends on how much time the matter requires. We can estimate based on similar cases, but I'll need to discuss with the attorney. We can also set a budget or cap if that helps."
OBJECTION: "Can we do a flat fee instead?" | OBJECTION: "Can we do a flat fee instead?"
Response | "Let me discuss that with the attorney. For some matters we can offer a flat fee, but it depends on the scope of work."
Build trust. Present fees clearly. Handle objections confidently and Assume the Close. Be honest, be empathetic, and always follow through.`,
}

export const SOP_524_ATTORNEY_REVIEW_PROCESS: SopDocument = {
  fileName: '5.2.4 Attorney Review Process',
  sectionCode: '5.2.4',
  docType: 'sop',
  text: `1. Internal Policy
It is the policy of the Firm that Attorneys provide legal input on Intake records only when escalation is required to support a business and legal decision. Attorneys do not perform Intake execution, status updates, client communication, or administrative actions during the Intake process.
This SOP governs the Attorney’s role in reviewing escalated Intake records and providing a legal recommendation to the Sales / Case Evaluator. All Intake execution, status management, client communication, and engagement processing are governed by separate SOPs.
Attorneys must follow this SOP to ensure consistent legal evaluation while maintaining clear separation of duties.
2. Procedure
2.1 Intake Escalation for Attorney Review
An Intake record is escalated to an Attorney when the Sales / Case Evaluator assigns the Case Status Pending Firm Decision.
The Attorney will be notified that legal input is required for the Intake record, by tagging the attorney in the Intake notes.
2.2 Attorney Review
Upon escalation, the Attorney must review the Intake record, including all available Intake information and supporting documentation.
The Attorney must evaluate the Intake to:
Assess if additional information is required and provide such requests, or
Provide specific guidance requested, or
Determine if the case should be accepted or Declined by the Firm, or
Referred to another firm.
The Attorney may request clarification or additional information from the Sales / Case Evaluator as needed to complete the review.
2.3 Attorney Recommendation
After completing the review, the Attorney must communicate a clear recommendation to the Sales / Case Evaluator.
The recommendation must indicate one of the following outcomes:
Provide specific information required for further evaluation, or
Provide specific responses to guidance requested, or
Accept the Intake and proceed toward engagement, or
Decline the Intake, or
Refer the Intake to another firm.
The Attorney doesn’t update Case Statuses, they may communicate decisions to the Potential Client, and/ or to the Sales/ Case evaluator by tagging them in the Intake notes to take further actions to close or send out Engagement letter.
2.4 Post-Recommendation Handling
Upon receiving the Attorney’s recommendation, the Sales / Case Evaluator is responsible for executing the appropriate Case Status updates in accordance with the Sales / Case Evaluator SOP.
If the Intake is declined or referred, the Intake Team will complete all required client communication and referral processing in accordance with the Intake SOP and Decline Notice SOP.
3. Resources
Resource #1: 5.1.1-b Intake definitions / glossary
Resource #2: Intake SOP (Separate SOP) Link
Resource #3: Sales / Case Evaluator Review SOP Link
Resource #4: 5.1.6  Decline Notice Functionality`,
}

export const SOP_526_FEE_STRUCTURE_POLICY: SopDocument = {
  fileName: '5.2.6 Fee structure policy',
  sectionCode: '5.2.6',
  docType: 'sop',
  text: `1. Internal Policy
It is the policy of the Firm that all legal services are billed in accordance with approved fee structures to ensure consistency, transparency, ethical compliance, and clear communication with clients.
The Firm utilizes hourly, flat fee, contingency, and hybrid billing arrangements based on the nature of the matter, client needs, and attorney involvement. All fee arrangements must be approved, documented, and communicated through a fully executed engagement agreement prior to the commencement of any legal services.
The billing rates outlined in this SOP have been approved by Firm leadership and apply unless a written exception is authorized by the Managing Partner.
2. Procedure
2.1 Fee Models
The Firm may bill legal services using the following approved fee structures:
Hourly Rate
Billed in 0.1-hour increments based on role-specific rates.
Flat Fee
A predetermined fee for a defined scope of legal services.
Contingency Fee
A percentage of recovery, subject to applicable law and a written contingency fee agreement.
Hybrid Fee
A combination of billing structures.
2.2 Assignment of Fee Structure
The applicable fee structure must be determined during client intake and documented in the engagement letter.
Contingency fees must comply with all jurisdictional regulations and be approved by the Managing Partner.
2.3 Engagement Letters
All clients must sign an engagement letter outlining the agreed-upon fee structure, billing terms, and payment obligations.
Fully executed engagement letters must be stored in the client file and uploaded to the Firm’s case management system.
2.4 Billing and Invoicing
Time entries must be recorded daily in the Firm’s timekeeping system.
Invoices are generated monthly unless otherwise specified in the engagement agreement.
Flat fees may be invoiced upfront or in defined milestones, as documented in the engagement letter.
2.5 Modifications and Exceptions
Any deviation from standard rates or fee structures must be approved in writing by the Managing Partner.
Adjusted rates must be documented and attached to the engagement record and billing file.
2.6 Annual Review
Fee structures and billing rates are reviewed annually to ensure market competitiveness and compliance.
3. Resources
Resource #1:  Guides and Rates
Resource #2:`,
}

export const ALL_SOPS: SopDocument[] = [
  SOP_511_B_INTAKE_DEFINITIONS_GLOSSARY,
  SOP_512_NEW_CLIENT_CALLS_INCOMING,
  SOP_512_A_INCOMING_INTAKE_SCRIPT,
  SOP_512_B_OUTGOING_INTAKE_SCRIPT,
  SOP_522_SALES_CASE_EVALUATOR_REVIEW_PROCESS,
  SOP_523_A_SALES_TEAM_PLAYBOOK,
  SOP_524_ATTORNEY_REVIEW_PROCESS,
  SOP_526_FEE_STRUCTURE_POLICY,
]
