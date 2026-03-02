import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { ethers } from 'ethers';
import { useAccount, useDisconnect, useWalletClient } from 'wagmi';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { NETWORK, FACTORY_ADDRESS } from '../config/network';
import { FACTORY_ABI, MARKET_ABI } from '../config/abis';

interface WalletState {
  provider: ethers.BrowserProvider | null;
  signer: ethers.Signer | null;
  address: string | null;
  isOwner: boolean;
  isConnected: boolean;
  isCorrectNetwork: boolean;
  isConnecting: boolean;
  error: string | null;
  connect: () => void;
  disconnect: () => void;
  switchNetwork: () => void;
  getFactoryContract: (withSigner?: boolean) => ethers.Contract | null;
  getMarketContract: (address: string, withSigner?: boolean) => ethers.Contract | null;
  readProvider: ethers.JsonRpcProvider;
}

const readProvider = new ethers.JsonRpcProvider(NETWORK.rpcUrl, {
  chainId: NETWORK.chainId,
  name: NETWORK.name,
});

const WalletContext = createContext<WalletState>({
  provider: null,
  signer: null,
  address: null,
  isOwner: false,
  isConnected: false,
  isCorrectNetwork: false,
  isConnecting: false,
  error: null,
  connect: () => {},
  disconnect: () => {},
  switchNetwork: () => {},
  getFactoryContract: () => null,
  getMarketContract: () => null,
  readProvider,
});

export function useWallet() {
  return useContext(WalletContext);
}

export function WalletProvider({ children }: { children: ReactNode }) {
  // ── wagmi hooks ──────────────────────────────────────────────
  const { address: wagmiAddress, isConnected: wagmiConnected, isConnecting: wagmiConnecting, chain } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { openConnectModal } = useConnectModal();
  const { disconnect: wagmiDisconnect } = useDisconnect();

  // ── Local state for ethers bridge + owner check ──────────────
  const [signer, setSigner] = useState<ethers.Signer | null>(null);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Derived state ────────────────────────────────────────────
  const isCorrectNetwork = chain?.id === NETWORK.chainId;
  const address = wagmiAddress ?? null;
  const isConnected = wagmiConnected;
  const isConnecting = wagmiConnecting;

  // ── Bridge walletClient → ethers BrowserProvider + Signer ────
  useEffect(() => {
    if (!walletClient) {
      setSigner(null);
      setProvider(null);
      return;
    }

    const { account, chain: wChain, transport } = walletClient;
    const network = {
      chainId: wChain.id,
      name: wChain.name,
    };
    const ethersProvider = new ethers.BrowserProvider(transport, network);
    setProvider(ethersProvider);
    ethersProvider
      .getSigner(account.address)
      .then((s) => setSigner(s))
      .catch(() => setSigner(null));
  }, [walletClient]);

  // ── Check if connected wallet is the factory owner ──────────
  useEffect(() => {
    if (!address) {
      setIsOwner(false);
      return;
    }
    (async () => {
      try {
        const factory = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, readProvider);
        const ownerAddr: string = await factory.owner();
        setIsOwner(ownerAddr.toLowerCase() === address.toLowerCase());
      } catch {
        setIsOwner(false);
      }
    })();
  }, [address]);

  // ── Actions (thin wrappers over RainbowKit / wagmi) ─────────
  const connect = useCallback(() => {
    setError(null);
    openConnectModal?.();
  }, [openConnectModal]);

  const disconnect = useCallback(() => {
    wagmiDisconnect();
    setError(null);
  }, [wagmiDisconnect]);

  const switchNetwork = useCallback(() => {
    // RainbowKit's ConnectButton already shows a network-switch UI.
    // This is a no-op fallback kept for API compatibility.
    openConnectModal?.();
  }, [openConnectModal]);

  // ── Contract helpers (unchanged) ────────────────────────────
  const getFactoryContract = useCallback(
    (withSigner = false): ethers.Contract | null => {
      const providerToUse = withSigner && signer ? signer : readProvider;
      return new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, providerToUse);
    },
    [signer],
  );

  const getMarketContract = useCallback(
    (marketAddress: string, withSigner = false): ethers.Contract | null => {
      const providerToUse = withSigner && signer ? signer : readProvider;
      return new ethers.Contract(marketAddress, MARKET_ABI, providerToUse);
    },
    [signer],
  );

  return (
    <WalletContext.Provider
      value={{
        provider,
        signer,
        address,
        isOwner,
        isConnected,
        isCorrectNetwork,
        isConnecting,
        error,
        connect,
        disconnect,
        switchNetwork,
        getFactoryContract,
        getMarketContract,
        readProvider,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}
