import { useState, useRef } from "react";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Product } from "@shared/schema";

import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";

// Category options
const categories = [
  { value: "art", label: "Art & Paintings" },
  { value: "jewelry", label: "Jewelry" },
  { value: "clothing", label: "Clothing" },
  { value: "home_decor", label: "Home Decor" },
  { value: "gifts", label: "Gifts" },
  { value: "accessories", label: "Accessories" },
  { value: "craft_supplies", label: "Craft Supplies" },
  { value: "paper_goods", label: "Paper Goods" },
  { value: "toys", label: "Toys & Games" },
];

// Form schema
const productFormSchema = z.object({
  title: z.string().min(5, "Title must be at least 5 characters"),
  description: z.string().min(20, "Description must be at least 20 characters"),
  price: z.string().refine((val) => !isNaN(Number(val)) && Number(val) > 0, {
    message: "Price must be a positive number",
  }),
  quantityAvailable: z.string().refine((val) => !isNaN(Number(val)) && Number(val) >= 0, {
    message: "Quantity must be a non-negative number",
  }),
  category: z.string().min(1, "Please select a category"),
  images: z.array(z.string()).min(1, "At least one image is required"),
});

type ProductFormValues = z.infer<typeof productFormSchema>;

interface ProductFormProps {
  product?: Product;
  onSuccess?: () => void;
}

export default function ProductForm({ product, onSuccess }: ProductFormProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [imageUrls, setImageUrls] = useState<string[]>(product?.images || []);
  const [uploadingImage, setUploadingImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const { user } = useAuth();

  const form = useForm<ProductFormValues>({
    resolver: zodResolver(productFormSchema),
    defaultValues: {
      title: product?.title || "",
      description: product?.description || "",
      price: product?.price ? String(product.price) : "",
      quantityAvailable: product?.quantityAvailable ? String(product.quantityAvailable) : "",
      category: product?.category || "",
      images: product?.images || [],
    },
  });

  const onSubmit = async (values: ProductFormValues) => {
    if (!user) {
      toast({
        title: "Authentication Error",
        description: "You must be logged in to perform this action",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);

    try {
      const productData = {
        sellerId: user.id,
        title: values.title,
        description: values.description,
        price: values.price, // Keep as string to match schema expectation
        quantityAvailable: parseInt(values.quantityAvailable),
        category: values.category,
        images: values.images,
      };

      if (product) {
        // Update existing product
        await apiRequest("PUT", `/api/products/${product.id}`, productData);
        toast({
          title: "Product Updated",
          description: "Your product has been updated successfully",
        });
      } else {
        // Create new product
        await apiRequest("POST", "/api/products", productData);
        toast({
          title: "Product Created",
          description: "Your product has been created successfully",
        });
      }

      // Invalidate product queries
      queryClient.invalidateQueries({ queryKey: ['/api/products'] });
      
      // Call onSuccess callback if provided
      if (onSuccess) {
        onSuccess();
      }
      
      // Reset form if creating new product
      if (!product) {
        form.reset();
        setImageUrls([]);
      }
    } catch (error: any) {
      toast({
        title: product ? "Update Failed" : "Creation Failed",
        description: error.message || "An error occurred",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleImageUpload = () => {
    // Trigger hidden file input click
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };
  
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Only accept images
    if (!file.type.startsWith('image/')) {
        console.error("Invalid file type:", file.type);
        toast({
            title: "Invalid File Type",
            description: "Please upload an image file (JPEG, PNG, etc.)",
            variant: "destructive",
        });
        return;
    }

    try {
        console.log("Uploading image:", file.name);
        setUploadingImage(true);

        // Create form data
        const formData = new FormData();
        formData.append('image', file);

        // Upload image
        const response = await fetch('/api/upload', {
            method: 'POST',
            body: formData,
            credentials: 'include',
        });

        if (!response.ok) {
            const errorData = await response.json();
            console.error("Image upload failed:", errorData.message);
            throw new Error(errorData.message || 'Failed to upload image');
        }

        const data = await response.json();
        console.log("Image uploaded successfully:", data.imageUrl);

        if (data.success) {
            // Add image URL to form state
            const newUrls = [...imageUrls, data.imageUrl];
            setImageUrls(newUrls);
            form.setValue("images", newUrls);

            toast({
                title: "Image Uploaded",
                description: "Image has been successfully uploaded",
            });
        } else {
            throw new Error(data.message || 'Failed to upload image');
        }
    } catch (error: any) {
        console.error("Error during image upload:", error.message);
        toast({
            title: "Upload Failed",
            description: error.message || "An error occurred while uploading the image",
            variant: "destructive",
        });
    } finally {
        setUploadingImage(false);
        // Reset file input
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    }
};

  const removeImage = (index: number) => {
    const updatedImages = [...imageUrls];
    updatedImages.splice(index, 1);
    setImageUrls(updatedImages);
    form.setValue("images", updatedImages);
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Product Title</FormLabel>
              <FormControl>
                <Input placeholder="Handcrafted Ceramic Vase" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        
        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Description</FormLabel>
              <FormControl>
                <Textarea 
                  placeholder="Provide a detailed description of your product..." 
                  className="min-h-[120px]"
                  {...field} 
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <FormField
            control={form.control}
            name="price"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Price ($)</FormLabel>
                <FormControl>
                  <Input type="number" min="0.01" step="0.01" placeholder="29.99" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          
          <FormField
            control={form.control}
            name="quantityAvailable"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Quantity Available</FormLabel>
                <FormControl>
                  <Input type="number" min="0" step="1" placeholder="10" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        
        <FormField
          control={form.control}
          name="category"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Category</FormLabel>
              <Select 
                onValueChange={field.onChange} 
                defaultValue={field.value}
              >
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a category" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {categories.map((category) => (
                    <SelectItem key={category.value} value={category.value}>
                      {category.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
        control={form.control}
        name="images"
        render={({ field }) => (
            <FormItem>
            <FormLabel>Product Images</FormLabel>
            {/* Hidden input to satisfy accessibility and autofill */}
            <Input type="hidden" {...field} />
            <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {imageUrls.map((url, index) => (
                <Card key={index} className="relative overflow-hidden">
                <Button 
                variant="destructive" 
                size="icon" 
                className="absolute top-2 right-2 h-6 w-6"
                type="button"
                onClick={() => removeImage(index)}
                >
                ✕
                </Button>
                <CardContent className="p-2">
                <img 
                src={url} 
                alt={`Product image ${index + 1}`} 
                className="w-full h-24 object-cover rounded"
                />
                </CardContent>
                </Card>
            ))}

            <Card className="border-dashed">
            <CardContent className="p-0">
            <Button
            type="button"
            variant="ghost"
            className="w-full h-full min-h-[104px] flex flex-col items-center justify-center"
            onClick={handleImageUpload}
            >
            <span className="text-2xl mb-1">+</span>
            <span className="text-sm">Add Image</span>
            </Button>
            </CardContent>
            </Card>
            </div>
            <FormMessage />
            </div>
            </FormItem>
        )}
        />

        {/* Hidden file input for image uploading */}
        <input
          type="file"
          ref={fileInputRef}
          accept="image/*"
          onChange={handleFileChange}
          className="hidden"
        />
        
        <Button type="submit" className="w-full" disabled={isLoading || uploadingImage}>
          {isLoading ? "Saving..." : (product ? "Update Product" : "Create Product")}
        </Button>
      </form>
    </Form>
  );
}
