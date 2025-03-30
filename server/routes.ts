import express, { type Express, type Request, type Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import bcrypt from "bcrypt";
import session from "express-session";
import multer from "multer";
import path from "path";
import fs from "fs";
import { z } from "zod";
import { 
  insertUserSchema, 
  insertProductSchema, 
  insertOrderSchema, 
  insertOrderItemSchema, 
  insertReviewSchema, 
  insertMessageSchema, 
  insertCartItemSchema 
} from "@shared/schema";
import Stripe from "stripe";

// Stripe setup
if (!process.env.STRIPE_SECRET_KEY) {
  console.error('Missing STRIPE_SECRET_KEY environment variable');
}
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
// Initialize Stripe with proper configuration for version 17
const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: '2023-10-16',  // Compatible with Stripe.js v6
  typescript: true,
});

// Session setup with PostgreSQL store for persistence
import pgSession from 'connect-pg-simple';
const PostgresStore = pgSession(session);

// Configure multer for file uploads
const uploadsDir = path.join(process.cwd(), "uploads");
const productsDir = path.join(uploadsDir, "products");

// Ensure directories exist
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
if (!fs.existsSync(productsDir)) {
  fs.mkdirSync(productsDir, { recursive: true });
}

// Setup multer storage
const uploadStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, productsDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, uniqueSuffix + ext);
  }
});

// Create multer upload instance
const upload = multer({
  storage: uploadStorage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: function (req, file, cb) {
    // Accept only images
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed') as any);
    }
  }
});

export async function registerRoutes(app: Express): Promise<Server> {
  // Serve uploaded files statically
  app.use('/uploads', express.static(uploadsDir));
  // Setup session with Postgres for persistence
  app.use(session({
    store: new PostgresStore({
      conString: process.env.DATABASE_URL,
      tableName: 'sessions', // Default
      createTableIfMissing: true, // Create the sessions table if it doesn't exist
    }),
    secret: process.env.SESSION_SECRET || 'your-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { 
      secure: process.env.NODE_ENV === 'production',
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
  }));

  // Middleware to check if user is authenticated
  const isAuthenticated = (req: Request, res: Response, next: Function) => {
    if (req.session.userId) {
      next();
    } else {
      res.status(401).json({ message: 'Unauthorized' });
    }
  };

  // Middleware to check if user has specific role
  const hasRole = (roles: string[]) => {
    return async (req: Request, res: Response, next: Function) => {
      if (!req.session.userId) {
        return res.status(401).json({ message: 'Unauthorized' });
      }
      
      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(401).json({ message: 'Unauthorized' });
      }
      
      if (!roles.includes(user.role)) {
        return res.status(403).json({ message: 'Forbidden' });
      }
      
      next();
    };
  };

  // Auth Routes
  app.post('/api/auth/register', async (req, res) => {
    try {
      const schema = insertUserSchema.extend({
        confirmPassword: z.string()
      }).refine((data) => data.password === data.confirmPassword, {
        message: "Passwords don't match",
        path: ["confirmPassword"],
      });
      
      const validatedData = schema.parse(req.body);
      const { confirmPassword, ...userData } = validatedData;
      
      // Check if user already exists
      const existingUser = await storage.getUserByEmail(userData.email);
      if (existingUser) {
        return res.status(400).json({ message: 'User with this email already exists' });
      }
      
      const existingUsername = await storage.getUserByUsername(userData.username);
      if (existingUsername) {
        return res.status(400).json({ message: 'Username already taken' });
      }
      
      // Hash password
      const hashedPassword = await bcrypt.hash(userData.password, 10);
      
      // Create user
      const user = await storage.createUser({
        ...userData,
        password: hashedPassword
      });
      
      // Set session
      req.session.userId = user.id;
      
      // Return user without password
      const { password, ...userWithoutPassword } = user;
      res.status(201).json(userWithoutPassword);
    } catch (error) {
      res.status(400).json({ message: error.message });
    }
  });

  app.post('/api/auth/login', async (req, res) => {
    try {
      const { email, password } = req.body;
      
      if (!email || !password) {
        return res.status(400).json({ message: 'Email and password are required' });
      }
      
      const user = await storage.getUserByEmail(email);
      if (!user) {
        return res.status(401).json({ message: 'Invalid credentials' });
      }
      
      const passwordMatch = await bcrypt.compare(password, user.password);
      if (!passwordMatch) {
        return res.status(401).json({ message: 'Invalid credentials' });
      }
      
      // Set session
      req.session.userId = user.id;
      
      // Return user without password
      const { password: _, ...userWithoutPassword } = user;
      res.json(userWithoutPassword);
    } catch (error) {
      res.status(400).json({ message: error.message });
    }
  });

  app.get('/api/auth/me', async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ message: 'Not authenticated' });
      }
      
      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }
      
      // Return user without password
      const { password, ...userWithoutPassword } = user;
      res.json(userWithoutPassword);
    } catch (error) {
      res.status(400).json({ message: error.message });
    }
  });

  app.post('/api/auth/logout', (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ message: 'Failed to logout' });
      }
      res.json({ message: 'Logged out successfully' });
    });
  });

  // Product Routes
  app.get('/api/products', async (req, res) => {
    try {
      const { category, search, sellerId } = req.query;
      
      let products;
      if (category) {
        products = await storage.getProductsByCategory(category as string);
      } else if (search) {
        products = await storage.searchProducts(search as string);
      } else if (sellerId) {
        products = await storage.getProductsBySeller(Number(sellerId));
      } else {
        products = await storage.getAllProducts();
      }
      
      res.json(products);
    } catch (error) {
      res.status(400).json({ message: error.message });
    }
  });

  app.get('/api/products/:id', async (req, res) => {
    try {
      const productId = Number(req.params.id);
      const product = await storage.getProduct(productId);
      
      if (!product) {
        return res.status(404).json({ message: 'Product not found' });
      }
      
      res.json(product);
    } catch (error) {
      res.status(400).json({ message: error.message });
    }
  });

  app.post('/api/products', isAuthenticated, hasRole(['seller', 'admin']), async (req, res) => {
    try {
      const productData = insertProductSchema.parse(req.body);
      
      // Ensure the seller is the logged in user
      if (productData.sellerId !== req.session.userId) {
        return res.status(403).json({ message: 'You can only create products for yourself' });
      }
      
      const product = await storage.createProduct(productData);
      res.status(201).json(product);
    } catch (error) {
      res.status(400).json({ message: error.message });
    }
  });

  app.put('/api/products/:id', isAuthenticated, hasRole(['seller', 'admin']), async (req, res) => {
    try {
      const productId = Number(req.params.id);
      const updates = req.body;
      
      const product = await storage.getProduct(productId);
      if (!product) {
        return res.status(404).json({ message: 'Product not found' });
      }
      
      // Check if user is seller of this product or admin
      const user = await storage.getUser(req.session.userId);
      if (user?.role !== 'admin' && product.sellerId !== req.session.userId) {
        return res.status(403).json({ message: 'You can only update your own products' });
      }
      
      const updatedProduct = await storage.updateProduct(productId, updates);
      res.json(updatedProduct);
    } catch (error) {
      res.status(400).json({ message: error.message });
    }
  });

  app.delete('/api/products/:id', isAuthenticated, hasRole(['seller', 'admin']), async (req, res) => {
    try {
      const productId = Number(req.params.id);
      
      const product = await storage.getProduct(productId);
      if (!product) {
        return res.status(404).json({ message: 'Product not found' });
      }
      
      // Check if user is seller of this product or admin
      const user = await storage.getUser(req.session.userId);
      if (user?.role !== 'admin' && product.sellerId !== req.session.userId) {
        return res.status(403).json({ message: 'You can only delete your own products' });
      }
      
      const deleted = await storage.deleteProduct(productId);
      if (deleted) {
        res.json({ message: 'Product deleted successfully' });
      } else {
        res.status(500).json({ message: 'Failed to delete product' });
      }
    } catch (error) {
      res.status(400).json({ message: error.message });
    }
  });

  // Cart Routes
  app.get('/api/cart', isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId;
      const cartItems = await storage.getCartItems(userId);
      
      // Get product details for each cart item
      const cartWithProducts = await Promise.all(cartItems.map(async (item) => {
        const product = await storage.getProduct(item.productId);
        return {
          ...item,
          product
        };
      }));
      
      res.json(cartWithProducts);
    } catch (error) {
      res.status(400).json({ message: error.message });
    }
  });

  app.post('/api/cart', isAuthenticated, async (req, res) => {
    try {
      const cartItemData = insertCartItemSchema.parse(req.body);
      
      // Ensure the user is the logged in user
      if (cartItemData.userId !== req.session.userId) {
        return res.status(403).json({ message: 'You can only add items to your own cart' });
      }
      
      // Check if product exists and has enough quantity
      const product = await storage.getProduct(cartItemData.productId);
      if (!product) {
        return res.status(404).json({ message: 'Product not found' });
      }
      
      if (+product.quantityAvailable < +cartItemData.quantity) {
        return res.status(400).json({ message: 'Not enough product in stock' });
      }
      
      const cartItem = await storage.addCartItem(cartItemData);
      
      // Get product info
      const cartWithProduct = {
        ...cartItem,
        product
      };
      
      res.status(201).json(cartWithProduct);
    } catch (error) {
      res.status(400).json({ message: error.message });
    }
  });

  app.put('/api/cart/:id', isAuthenticated, async (req, res) => {
    try {
      const cartItemId = Number(req.params.id);
      const { quantity } = req.body;
      
      if (!quantity || quantity < 1) {
        return res.status(400).json({ message: 'Quantity must be at least 1' });
      }
      
      const cartItem = await storage.updateCartItemQuantity(cartItemId, quantity);
      if (!cartItem) {
        return res.status(404).json({ message: 'Cart item not found' });
      }
      
      // Get product info
      const product = await storage.getProduct(cartItem.productId);
      const cartWithProduct = {
        ...cartItem,
        product
      };
      
      res.json(cartWithProduct);
    } catch (error) {
      res.status(400).json({ message: error.message });
    }
  });

  app.delete('/api/cart/:id', isAuthenticated, async (req, res) => {
    try {
      const cartItemId = Number(req.params.id);
      const deleted = await storage.removeCartItem(cartItemId);
      
      if (deleted) {
        res.json({ message: 'Cart item removed successfully' });
      } else {
        res.status(404).json({ message: 'Cart item not found' });
      }
    } catch (error) {
      res.status(400).json({ message: error.message });
    }
  });

  app.delete('/api/cart', isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId;
      const cleared = await storage.clearCart(userId);
      
      if (cleared) {
        res.json({ message: 'Cart cleared successfully' });
      } else {
        res.status(500).json({ message: 'Failed to clear cart' });
      }
    } catch (error) {
      res.status(400).json({ message: error.message });
    }
  });

  app.post('/api/cart/clear', async (req, res) => {
    try {
        console.log("Clear cart request received for user:", req.session?.userId);

        const userId = req.session.userId;
        if (!userId) {
            console.error("User not authenticated");
            return res.status(401).json({ message: 'User not authenticated' });
        }

        const cleared = await storage.clearCart(userId);
        if (cleared) {
            console.log("Cart cleared successfully for user:", userId);
            res.json({ message: 'Cart cleared successfully' });
        } else {
            console.error("Failed to clear cart for user:", userId);
            res.status(500).json({ message: 'Failed to clear cart' });
        }
    } catch (error) {
        console.error("Error clearing cart:", error.message);
        res.status(400).json({ message: error.message });
    }
});

  // Image Upload API
  app.post('/api/upload', isAuthenticated, upload.single('image'), async (req, res) => {
    try {
        console.log("Image upload request received");

        // Check if file exists
        if (!req.file) {
            console.error("No file uploaded");
            return res.status(400).json({ message: 'No file uploaded' });
        }

        // Log file details
        console.log("Uploaded file details:", req.file);

        // Return the path to the uploaded file
        const serverUrl = `${req.protocol}://${req.get('host')}`;
        const filePath = `/uploads/products/${req.file.filename}`;
        const fileUrl = `${serverUrl}${filePath}`;

        console.log("File uploaded successfully:", fileUrl);

        res.json({
            success: true,
            imageUrl: fileUrl,
        });
    } catch (error) {
        console.error("Error during image upload:", error.message);
        res.status(500).json({ message: 'Failed to upload image' });
    }
});

  // Order Routes
  app.get('/api/orders', isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId;
      const user = await storage.getUser(userId);
      
      let orders;
      if (user?.role === 'admin') {
        orders = await storage.getAllOrders();
      } else if (user?.role === 'seller') {
        orders = await storage.getOrdersForSellerProducts(userId);
      } else {
        orders = await storage.getOrdersByBuyer(userId);
      }
      
      // Get order items for each order
      const ordersWithItems = await Promise.all(orders.map(async (order) => {
        const items = await storage.getOrderItems(order.id);
        return {
          ...order,
          items
        };
      }));
      
      res.json(ordersWithItems);
    } catch (error) {
      res.status(400).json({ message: error.message });
    }
  });

  app.get('/api/orders/:id', isAuthenticated, async (req, res) => {
    try {
      const orderId = Number(req.params.id);
      const order = await storage.getOrder(orderId);
      
      if (!order) {
        return res.status(404).json({ message: 'Order not found' });
      }
      
      // Check if user is allowed to view this order
      const userId = req.session.userId;
      const user = await storage.getUser(userId);
      
      if (user?.role !== 'admin' && order.buyerId !== userId) {
        const sellerProducts = await storage.getProductsBySeller(userId);
        const orderItems = await storage.getOrderItems(orderId);
        
        const isSeller = orderItems.some(item => 
          sellerProducts.some(product => product.id === item.productId)
        );
        
        if (!isSeller) {
          return res.status(403).json({ message: 'You are not authorized to view this order' });
        }
      }
      
      // Get order items
      const items = await storage.getOrderItems(orderId);
      
      // Get product details for each item
      const itemsWithProducts = await Promise.all(items.map(async (item) => {
        const product = await storage.getProduct(item.productId);
        return {
          ...item,
          product
        };
      }));
      
      res.json({
        ...order,
        items: itemsWithProducts
      });
    } catch (error) {
      res.status(400).json({ message: error.message });
    }
  });

  app.post('/api/orders', isAuthenticated, async (req, res) => {
    try {
      const { order, items } = req.body;
      
      if (!order || !items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: 'Order must include items' });
      }
      
      console.log('Received order data:', JSON.stringify(order));
      
      try {
        const orderData = insertOrderSchema.parse(order);
      
      // Ensure the buyer is the logged in user
      if (orderData.buyerId !== req.session.userId) {
        return res.status(403).json({ message: 'You can only create orders for yourself' });
      }
      
      // Validate all items
      for (const item of items) {
        try {
          // Ensure unitPrice is handled as a string for Zod validation
          const itemToValidate = {
            ...item,
            unitPrice: item.unitPrice ? String(item.unitPrice) : item.unitPrice
          };
          
          // Create a new schema without orderId for validation
          const orderItemWithoutOrderIdSchema = z.object({
            productId: z.number(),
            quantity: z.number().min(1),
            unitPrice: z.string(),
          });
          
          const validatedItem = orderItemWithoutOrderIdSchema.parse(itemToValidate);
          
          // Check if product exists and has enough quantity
          const product = await storage.getProduct(validatedItem.productId);
          if (!product) {
            return res.status(404).json({ message: `Product with ID ${validatedItem.productId} not found` });
          }
          
          if (+product.quantityAvailable < +validatedItem.quantity) {
            return res.status(400).json({ 
              message: `Not enough quantity for product ${product.title}. Available: ${product.quantityAvailable}` 
            });
          }
        } catch (validationError) {
          console.error('Item validation error:', validationError);
          return res.status(400).json({ 
            message: validationError.message || 'Item validation error',
            details: validationError.errors || validationError
          });
        }
      }
      
      // Create order
      const newOrder = await storage.createOrder(orderData, items);
      
      // Clear the cart
      await storage.clearCart(req.session.userId);
      
      res.status(201).json(newOrder);
      } catch (validationError) {
        console.error('Order validation error:', validationError);
        return res.status(400).json({ 
          message: validationError.message || 'Validation error',
          details: validationError.errors || validationError
        });
      }
    } catch (error) {
      console.error('Order creation error:', error);
      res.status(400).json({ 
        message: error.message || 'Error creating order',
        details: error.errors || error
      });
    }
  });

  app.patch('/api/orders/:id/status', isAuthenticated, hasRole(['seller', 'admin']), async (req, res) => {
    try {
      const orderId = Number(req.params.id);
      const { status } = req.body;
      
      if (!status) {
        return res.status(400).json({ message: 'Status is required' });
      }
      
      // Validate status
      if (!['pending', 'processing', 'shipped', 'delivered', 'cancelled'].includes(status)) {
        return res.status(400).json({ message: 'Invalid status' });
      }
      
      const order = await storage.getOrder(orderId);
      if (!order) {
        return res.status(404).json({ message: 'Order not found' });
      }
      
      // Check if seller has permission to update this order
      if (req.session.userId !== 'admin') {
        const orderItems = await storage.getOrderItems(orderId);
        const sellerProducts = await storage.getProductsBySeller(req.session.userId);
        const sellerProductIds = sellerProducts.map(p => p.id);
        
        const isSeller = orderItems.some(item => sellerProductIds.includes(item.productId));
        
        if (!isSeller) {
          return res.status(403).json({ message: 'You can only update orders for your products' });
        }
      }
      
      const updatedOrder = await storage.updateOrderStatus(orderId, status);
      res.json(updatedOrder);
    } catch (error) {
      res.status(400).json({ message: error.message });
    }
  });

  // Review Routes
  app.get('/api/products/:id/reviews', async (req, res) => {
    try {
      const productId = Number(req.params.id);
      const reviews = await storage.getReviewsForProduct(productId);
      
      // Get user details for each review
      const reviewsWithUsers = await Promise.all(reviews.map(async (review) => {
        const user = await storage.getUser(review.buyerId);
        return {
          ...review,
          user: user ? { id: user.id, name: user.name, username: user.username } : null
        };
      }));
      
      res.json(reviewsWithUsers);
    } catch (error) {
      res.status(400).json({ message: error.message });
    }
  });

  app.post('/api/products/:id/reviews', isAuthenticated, async (req, res) => {
    try {
      const productId = Number(req.params.id);
      const reviewData = insertReviewSchema.parse(req.body);
      
      // Ensure the buyer is the logged in user
      if (reviewData.buyerId !== req.session.userId) {
        return res.status(403).json({ message: 'You can only create reviews as yourself' });
      }
      
      // Check if product exists
      const product = await storage.getProduct(productId);
      if (!product) {
        return res.status(404).json({ message: 'Product not found' });
      }
      
      // Verify the user has purchased this product
      const userOrders = await storage.getOrdersByBuyer(req.session.userId);
      const userOrderIds = userOrders.map(o => o.id);
      
      let hasPurchased = false;
      for (const orderId of userOrderIds) {
        const orderItems = await storage.getOrderItems(orderId);
        if (orderItems.some(item => item.productId === productId)) {
          hasPurchased = true;
          break;
        }
      }
      
      if (!hasPurchased) {
        return res.status(403).json({ message: 'You can only review products you have purchased' });
      }
      
      // Create review
      const review = await storage.createReview({
        ...reviewData,
        productId
      });
      
      // Get user info
      const user = await storage.getUser(review.buyerId);
      
      res.status(201).json({
        ...review,
        user: user ? { id: user.id, name: user.name, username: user.username } : null
      });
    } catch (error) {
      res.status(400).json({ message: error.message });
    }
  });

  // Message Routes
  app.get('/api/messages/:userId', isAuthenticated, async (req, res) => {
    try {
      const otherUserId = Number(req.params.userId);
      const userId = req.session.userId;
      
      const messages = await storage.getMessagesBetweenUsers(userId, otherUserId);
      
      res.json(messages);
    } catch (error) {
      res.status(400).json({ message: error.message });
    }
  });

  app.post('/api/messages', isAuthenticated, async (req, res) => {
    try {
      const messageData = insertMessageSchema.parse(req.body);
      
      // Ensure the sender is the logged in user
      if (messageData.senderId !== req.session.userId) {
        return res.status(403).json({ message: 'You can only send messages as yourself' });
      }
      
      // Check if receiver exists
      const receiver = await storage.getUser(messageData.receiverId);
      if (!receiver) {
        return res.status(404).json({ message: 'Receiver not found' });
      }
      
      const message = await storage.createMessage(messageData);
      res.status(201).json(message);
    } catch (error) {
      res.status(400).json({ message: error.message });
    }
  });

  // Admin Routes
  app.get('/api/admin/users', isAuthenticated, hasRole(['admin']), async (req, res) => {
    try {
      const users = await storage.getAllUsers();
      
      // Remove passwords
      const usersWithoutPasswords = users.map(({ password, ...user }) => user);
      
      res.json(usersWithoutPasswords);
    } catch (error) {
      res.status(400).json({ message: error.message });
    }
  });

  app.patch('/api/admin/users/:id', isAuthenticated, hasRole(['admin']), async (req, res) => {
    try {
      const userId = Number(req.params.id);
      const { role } = req.body;
      
      if (!role) {
        return res.status(400).json({ message: 'Role is required' });
      }
      
      // Validate role
      if (!['buyer', 'seller', 'admin'].includes(role)) {
        return res.status(400).json({ message: 'Invalid role' });
      }
      
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }
      
      const updatedUser = await storage.updateUser(userId, { role });
      
      // Remove password
      const { password, ...userWithoutPassword } = updatedUser!;
      
      res.json(userWithoutPassword);
    } catch (error) {
      res.status(400).json({ message: error.message });
    }
  });

  // Payment Routes
  app.post('/api/create-payment-intent', isAuthenticated, async (req, res) => {
    try {
      const { amount, orderId } = req.body;
      
      if (!amount || typeof amount === 'undefined' || isNaN(parseFloat(String(amount)))) {
        return res.status(400).json({ message: 'Valid amount is required' });
      }
      
      // Check if Stripe API key is available
      if (!process.env.STRIPE_SECRET_KEY) {
        return res.status(500).json({ message: 'Stripe payment service is not configured' });
      }
      
      console.log('Creating payment intent with amount:', amount, 'Type:', typeof amount);
      
      // Create a payment intent with improved options for test mode
      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(parseFloat(String(amount)) * 100), // Convert to cents and ensure integer
        currency: 'usd',
        // Add metadata to help identify the payment
        metadata: {
          user_id: req.session.userId?.toString() || 'unknown',
          order_id: orderId?.toString() || '',
          integration_type: 'marketplace',
          environment: process.env.NODE_ENV || 'development'
        },
        // Use automatic payment methods
        automatic_payment_methods: {
          enabled: true
        }
      });
      
      console.log(`Payment intent created: ${paymentIntent.id}`);
      
      // If we have an order ID, update the order with payment intent information
      if (orderId) {
        await storage.updateOrder(Number(orderId), {
          paymentIntentId: paymentIntent.id,
          paymentStatus: 'pending'
        });
      }
      
      res.json({
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
        orderId: orderId // Return the orderId for use in the redirect URL
      });
    } catch (error) {
      console.error('Error creating payment intent:', error);
      res.status(400).json({ 
        message: error instanceof Error ? error.message : 'Unknown payment processing error' 
      });
    }
  });
  
  // Get order by payment intent ID
  app.get('/api/payment/:paymentIntentId/order', isAuthenticated, async (req, res) => {
    try {
      const { paymentIntentId } = req.params;
      
      if (!paymentIntentId) {
        return res.status(400).json({ message: 'Payment intent ID is required' });
      }
      
      // Find order with this payment intent ID
      const orders = await storage.getAllOrders();
      const order = orders.find(o => o.paymentIntentId === paymentIntentId);
      
      if (!order) {
        return res.status(404).json({ message: 'Order not found for this payment' });
      }
      
      // Check permissions
      const userId = req.session.userId;
      if (order.buyerId !== userId) {
        const user = await storage.getUser(userId);
        if (user?.role !== 'admin') {
          return res.status(403).json({ message: 'Not authorized to view this order' });
        }
      }
      
      // Get order items
      const items = await storage.getOrderItems(order.id);
      
      // Get product details for each item
      const itemsWithProducts = await Promise.all(items.map(async (item) => {
        const product = await storage.getProduct(item.productId);
        return {
          ...item,
          product
        };
      }));
      
      res.json({
        ...order,
        items: itemsWithProducts
      });
    } catch (error) {
      console.error('Error retrieving order by payment intent:', error);
      res.status(400).json({ message: error.message });
    }
  });

  const httpServer = createServer(app);

  return httpServer;
}
