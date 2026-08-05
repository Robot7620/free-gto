# Free GTO Poker Trainer

A free, open-source alternative to commercial GTO poker solvers like PioSOLVER and GTO+. Built with React, TypeScript, and a custom CFR (Counterfactual Regret Minimization) solver.

## 🎯 Features

### Current MVP (v0.1.0)
- ✅ **Poker Engine**
  - 7-card hand evaluator
  - Monte Carlo equity calculator
  - Range representation and operations (169 hand combos)
  
- ✅ **GTO Solver**
  - CFR algorithm implementation
  - Game tree builder
  - Information set management
  - Strategy computation

- ✅ **User Interface**
  - Interactive range grid (13x13 matrix)
  - Board visualizer with card graphics
  - Strategy table with action frequencies
  - Demo scenario: BTN vs BB postflop c-bet spot

## 🚀 Getting Started

### Prerequisites
- Node.js 18+ 
- npm or yarn

### Installation

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

The app will be available at `http://localhost:5173`

## 📖 How It Works

### Poker Engine
The core poker engine includes:
- **Card representation**: Efficient suit/rank encoding
- **Hand evaluator**: Fast 7-card evaluation with proper hand rankings
- **Equity calculator**: Monte Carlo simulation for hand vs range equity
- **Range operations**: Union, intersection, removal, scaling

### CFR Solver
The GTO solver uses Counterfactual Regret Minimization:
1. **Game Tree**: Represents all possible actions (check, bet sizes, fold, call)
2. **Information Sets**: Groups similar game states for each player
3. **Regret Matching**: Iteratively updates strategies based on regret minimization
4. **Convergence**: Approaches Nash equilibrium (GTO) over many iterations

### Demo Scenario
The current demo shows a simplified BTN vs BB postflop spot:
- **Situation**: K♠9♥4♣ flop, single raised pot
- **Stack**: 100bb effective
- **Pot**: 10bb
- **Action**: BTN's c-betting strategy vs BB's calling range

Click "Solve This Spot" to run 1000 CFR iterations and see the computed GTO strategy.

## 🛠️ Architecture

```
src/
├── engine/          # Poker game logic
│   ├── cards.ts     # Card representation, deck utilities
│   ├── evaluator.ts # Hand strength evaluation
│   ├── equity.ts    # Monte Carlo equity calculations
│   └── range.ts     # Range representation and operations
├── solver/          # GTO solver
│   ├── cfr.ts       # CFR algorithm
│   ├── game-tree.ts # Game state tree
│   └── infoset.ts   # Information set management
├── components/      # React UI components
│   ├── RangeGrid.tsx     # 13x13 hand range selector
│   ├── BoardView.tsx     # Community cards display
│   ├── Card.tsx          # Single card component
│   └── StrategyTable.tsx # Action frequencies table
└── utils/
    └── poker.ts     # Poker constants and helpers
```

## 🎮 Usage

### Understanding the Range Grid
- **Diagonal**: Pocket pairs (AA, KK, QQ, etc.)
- **Above diagonal**: Suited hands (AKs, KQs, etc.)
- **Below diagonal**: Offsuit hands (AKo, KQo, etc.)
- **Colors**: 
  - Gray: Not in range (0%)
  - Red: <25% frequency
  - Orange: 25-50%
  - Yellow: 50-75%
  - Green: 75-100%

### Reading the Strategy Table
- **Frequency bars**: Visual representation of how often each action is taken
- **Percentage**: Exact frequency for each action
- **EV** (coming soon): Expected value for each action

## 🔮 Roadmap

### v0.2 - Enhanced Solver
- [ ] Multi-street solving (flop → turn → river)
- [ ] Bet sizing optimization
- [ ] Custom scenario builder
- [ ] Solution export/import

### v0.3 - Training Features
- [ ] Quiz mode (test your decisions vs GTO)
- [ ] Precomputed scenario library
- [ ] Hand replayer with GTO overlay
- [ ] Performance tracking

### v0.4 - Advanced Features
- [ ] Multi-way pots (3+ players)
- [ ] Range equity graphs
- [ ] Node locking
- [ ] Hand history import

### v1.0 - Desktop App
- [ ] Electron wrapper
- [ ] Local database (SQLite)
- [ ] Native performance optimizations
- [ ] Auto-updates

## 🧮 Performance

Current benchmarks (approximate):
- Hand evaluation: <1ms for 1000 evaluations
- Equity calculation: ~50ms for 2-way, 10k iterations
- CFR iteration: ~10-20ms per iteration (depends on game tree size)

## 🤝 Contributing

This is an open-source project. Contributions welcome!

Areas that need work:
- Performance optimization (Web Workers, WASM)
- More sophisticated bet sizing
- Better UI/UX
- Testing and validation
- Documentation

## 📄 License

MIT License - Free to use, modify, and distribute

## 🙏 Acknowledgments

Inspired by:
- PioSOLVER
- GTO+
- MonkerSolver

Built with:
- React + TypeScript
- Vite
- Tailwind CSS

## ⚠️ Disclaimer

This is an educational project and MVP. For serious GTO study, commercial solvers offer more features and have been extensively tested. This tool is best for:
- Learning GTO concepts
- Quick spot checking
- Studying without subscription costs
- Understanding how solvers work under the hood

---

**Built by poker players, for poker players. Free forever.**
