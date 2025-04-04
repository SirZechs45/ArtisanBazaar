import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { AuthProvider } from "@/lib/auth";
import { CartProvider } from "./hooks/useCart";

import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import Auth from "@/pages/auth";
import ProductsPage from "@/pages/products/index";
import ProductDetail from "@/pages/products/[id]";
import Checkout from "@/pages/checkout";
import SellerDashboard from "@/pages/dashboard/seller/index";
import SellerProducts from "@/pages/dashboard/seller/products";
import NewProduct from "@/pages/dashboard/seller/products/new";
import SellerOrders from "@/pages/dashboard/seller/orders";
import AdminDashboard from "@/pages/dashboard/admin/index";
import AdminUsers from "@/pages/dashboard/admin/users";
import AdminProducts from "@/pages/dashboard/admin/products";

function Router() {
  return (
    <Switch>
      {/* Public Routes */}
      <Route path="/" component={Home} />
      <Route path="/auth" component={Auth} />
      <Route path="/products" component={ProductsPage} />
      <Route path="/products/:id" component={ProductDetail} />
      
      {/* Protected Routes */}
      <Route path="/checkout" component={Checkout} />
      
      {/* Seller Routes */}
      <Route path="/dashboard/seller" component={SellerDashboard} />
      <Route path="/dashboard/seller/products" component={SellerProducts} />
      <Route path="/dashboard/seller/products/new" component={NewProduct} />
      <Route path="/dashboard/seller/orders" component={SellerOrders} />
      
      {/* Admin Routes */}
      <Route path="/dashboard/admin" component={AdminDashboard} />
      <Route path="/dashboard/admin/users" component={AdminUsers} />
      <Route path="/dashboard/admin/products" component={AdminProducts} />
      
      {/* Fallback to 404 */}
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <CartProvider>
          <Router />
          <Toaster />
        </CartProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
