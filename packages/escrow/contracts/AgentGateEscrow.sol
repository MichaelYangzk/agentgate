// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract AgentGateEscrow {
    using SafeERC20 for IERC20;

    enum EscrowStatus { Active, Completed, Disputed, Refunded, Expired }

    struct Escrow {
        address buyer;          // agent/user who locks funds
        address seller;         // agent/user who receives on completion
        address evaluator;      // third-party evaluator (can be zero for auto-release)
        address token;          // ERC20 token (USDC)
        uint256 amount;
        uint256 deadline;       // timestamp after which auto-release or refund
        EscrowStatus status;
        string purposeHash;     // IPFS hash or description hash
        uint256 createdAt;
    }

    uint256 public escrowCount;
    uint256 public feeRate = 50;  // 0.5% = 50 basis points
    address public feeRecipient;
    address public owner;

    mapping(uint256 => Escrow) public escrows;

    event EscrowCreated(uint256 indexed id, address buyer, address seller, uint256 amount, address token);
    event EscrowCompleted(uint256 indexed id, address releasedBy);
    event EscrowDisputed(uint256 indexed id, address disputedBy);
    event EscrowRefunded(uint256 indexed id);
    event EscrowExpired(uint256 indexed id);
    event EvaluatorVerdict(uint256 indexed id, bool approved, string reason);

    modifier onlyOwner() { require(msg.sender == owner, "Not owner"); _; }
    modifier onlyBuyer(uint256 id) { require(msg.sender == escrows[id].buyer, "Not buyer"); _; }
    modifier onlyEvaluator(uint256 id) {
        require(escrows[id].evaluator != address(0), "No evaluator set");
        require(msg.sender == escrows[id].evaluator, "Not evaluator");
        _;
    }
    modifier isActive(uint256 id) { require(escrows[id].status == EscrowStatus.Active, "Not active"); _; }

    constructor(address _feeRecipient) {
        owner = msg.sender;
        feeRecipient = _feeRecipient;
    }

    // Create a new escrow — buyer locks tokens
    function createEscrow(
        address seller,
        address evaluator,
        address token,
        uint256 amount,
        uint256 deadline,
        string calldata purposeHash
    ) external returns (uint256) {
        require(seller != address(0), "Invalid seller");
        require(amount > 0, "Amount must be > 0");
        require(deadline > block.timestamp, "Deadline must be future");

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        uint256 id = escrowCount++;
        escrows[id] = Escrow({
            buyer: msg.sender,
            seller: seller,
            evaluator: evaluator,
            token: token,
            amount: amount,
            deadline: deadline,
            status: EscrowStatus.Active,
            purposeHash: purposeHash,
            createdAt: block.timestamp
        });

        emit EscrowCreated(id, msg.sender, seller, amount, token);
        return id;
    }

    // Buyer releases funds to seller (manual approval)
    function release(uint256 id) external onlyBuyer(id) isActive(id) {
        _release(id, msg.sender);
    }

    // Evaluator approves — releases funds to seller
    function evaluatorApprove(uint256 id, string calldata reason) external onlyEvaluator(id) isActive(id) {
        emit EvaluatorVerdict(id, true, reason);
        _release(id, msg.sender);
    }

    // Evaluator rejects — refunds buyer
    function evaluatorReject(uint256 id, string calldata reason) external onlyEvaluator(id) isActive(id) {
        emit EvaluatorVerdict(id, false, reason);
        _refund(id);
    }

    // Either party can dispute
    function dispute(uint256 id) external isActive(id) {
        Escrow storage e = escrows[id];
        require(msg.sender == e.buyer || msg.sender == e.seller, "Not party");
        e.status = EscrowStatus.Disputed;
        emit EscrowDisputed(id, msg.sender);
    }

    // Anyone can trigger auto-release after deadline (if no evaluator)
    function releaseAfterDeadline(uint256 id) external isActive(id) {
        Escrow storage e = escrows[id];
        require(block.timestamp >= e.deadline, "Deadline not reached");
        require(e.evaluator == address(0), "Has evaluator, use evaluator flow");
        _release(id, msg.sender);
    }

    // Buyer can refund if deadline passed and no delivery (with evaluator)
    function refundAfterDeadline(uint256 id) external onlyBuyer(id) isActive(id) {
        require(block.timestamp >= escrows[id].deadline, "Deadline not reached");
        _refund(id);
    }

    // Owner can update fee rate
    function setFeeRate(uint256 _feeRate) external onlyOwner {
        require(_feeRate <= 500, "Fee too high"); // max 5%
        feeRate = _feeRate;
    }

    // Internal release — sends funds to seller minus fee
    function _release(uint256 id, address releasedBy) internal {
        Escrow storage e = escrows[id];
        e.status = EscrowStatus.Completed;

        uint256 fee = (e.amount * feeRate) / 10000;
        uint256 payout = e.amount - fee;

        IERC20(e.token).safeTransfer(e.seller, payout);
        if (fee > 0) {
            IERC20(e.token).safeTransfer(feeRecipient, fee);
        }

        emit EscrowCompleted(id, releasedBy);
    }

    // Internal refund — returns funds to buyer
    function _refund(uint256 id) internal {
        Escrow storage e = escrows[id];
        e.status = EscrowStatus.Refunded;
        IERC20(e.token).safeTransfer(e.buyer, e.amount);
        emit EscrowRefunded(id);
    }

    // View function
    function getEscrow(uint256 id) external view returns (Escrow memory) {
        return escrows[id];
    }
}
